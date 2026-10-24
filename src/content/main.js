// Content-script entry point (design 5.1a, 5.3, 5.3a). Runs at document_start.
// Scans with a TreeWalker over text and the title/aria-label/alt attributes,
// then a throttled, budgeted MutationObserver processes only changed subtrees.
// Processed nodes are cached by node + text hash so recycled feed nodes are
// re-checked. Our own injected nodes are ignored to avoid recursive matching.

import {
  loadState,
  onStateChanged,
  loadDeviceState,
  onDeviceStateChanged,
  isPaused,
  bumpCounter,
} from "../shared/storage.js";
import { compileMatcher, displayTerm } from "./matcher.js";
import { findContainer } from "./container.js";
import { makeCandidateWalker, isSkippable } from "./scan.js";
import { reverify } from "./durability.js";
import { ruleOneTerm, storyCounts, shouldCoverByStories, mostMatchedTerm } from "./whole-page.js";
import { storyKey, isRevealed, reset as resetRevealed } from "./revealed.js";
import * as pageCover from "./page-cover.js";
import * as pageMode from "./page-mode.js";
import * as overlay from "./overlay.js";

const DEBUG = false;

const win = window;
const doc = document;

/** Whole-page blackout state (design 3.6). pageMode holds the either/or state. */
let prefs = null;
/** include term (as entered) -> {count}; picks the most-matched cover term. */
let termInfo = new Map();

/** Attributes that carry matchable text (design 5.1). */
const ATTRS = ["title", "aria-label", "alt"];

/** Batch no more often than this, and never run longer than the cap (5.3). */
const MIN_INTERVAL_MS = 100;
const MAX_BATCH_MS = 50;

/** @type {import("./matcher.js").Matcher|null} */
let matcher = null;
/** Paused on this device/site (design 3.1, FR-09); recomputed from local state. */
let paused = false;

/**
 * node -> {hash, container}: the text last processed for it and the container
 * that mask produced (or null). Cache validity is node + text hash + mask still
 * present, so a node whose mask was stripped is re-evaluated (design 5.3a).
 * @type {WeakMap<Node, {hash: number, container: Element|null}>}
 */
let processed = new WeakMap();

/** Containers we have blacked out, for teardown and re-verification. */
const activeContainers = new Set();

/** masked container -> the include term that masked it (for revealed identity). */
let storyTerm = new WeakMap();

/** Masked containers to re-verify (deduped), and the queue draining them. */
let reverifyQueue = [];
let reverifyPending = new WeakSet();

/** Roots waiting to be scanned, and the walker currently being drained. */
let pending = [];
let active = null;

const perfNow = () =>
  win.performance && win.performance.now ? win.performance.now() : Date.now();

/**
 * Log one decision line, prefixed, only when DEBUG is on (the build flips this
 * to true for `npm run build -- --debug`; src stays false).
 * @param {...unknown} args
 */
function log(...args) {
  if (DEBUG) console.log("[blackout]", ...args);
}

/** @param {string} text @returns {string} first 60 chars, whitespace collapsed */
function snippet(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** @param {Element|null} el */
function roleOf(el) {
  return (el && el.getAttribute && el.getAttribute("role")) || "";
}

/** @param {Element|null} el @returns {string} "WxH" from the layout box */
function sizeOf(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return "0x0";
  const r = el.getBoundingClientRect();
  return `${Math.round(r.width)}x${Math.round(r.height)}`;
}

/** Counters for the current scan, reported when the queue drains. */
let examinedText = 0;
let examinedAttrs = 0;

/** Elements already logged as a refusal, so identical refusals log once. */
let refusalLogged = new WeakSet();

/** @param {import("./container.js").ContainerDecision} decision */
function logRefused(decision) {
  if (!DEBUG) return;
  const el = decision.element;
  if (el) {
    if (refusalLogged.has(el)) return;
    refusalLogged.add(el);
  }
  log(
    `container refused reason=${decision.reason} tag=${el ? el.tagName : ""} role="${roleOf(el)}" size=${sizeOf(el)}`,
  );
}

/**
 * True if node is (or lives inside) one of our injected elements.
 * @param {Node|null} node
 */
function isOwnNode(node) {
  let el = node && node.nodeType === 3 ? node.parentNode : node;
  while (el && el.nodeType === 1) {
    if (el.id === "blackout-stylesheet") return true;
    if (el.classList && el.classList.contains("blackout-ui")) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * @param {string} s
 * @returns {number} 32-bit FNV-1a hash
 */
function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeWalker(root) {
  return { walker: makeCandidateWalker(doc, root, isOwnNode), root, rootDone: false };
}

/**
 * Observes each masked container for class changes and direct child removal, so
 * if the page strips our class or injected child we re-verify and re-apply.
 * Uses intactness (not mutation filtering) to ignore our own writes.
 */
const maskObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (activeContainers.has(m.target)) enqueueReverify(/** @type {Element} */ (m.target));
  }
  scheduleFlush();
});

/** @param {Element} container */
function enqueueReverify(container) {
  if (reverifyPending.has(container)) return;
  reverifyPending.add(container);
  reverifyQueue.push(container);
}

/** The nearest ancestor-or-self that is a masked container, or null. */
function maskedAncestor(node) {
  let el = node && node.nodeType === 3 ? node.parentElement : node;
  while (el && el.nodeType === 1) {
    if (activeContainers.has(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Test one piece of candidate text and, on a hit, black out its container.
 * @param {Node} cacheKey
 * @param {Element|null} element
 * @param {string} text
 */
function handleCandidate(cacheKey, element, text) {
  if (!element) return;
  if (!pageMode.canMaskCards()) return; // whole-page mode: no per-card masks (3.6)
  const h = hashText(text);
  const prev = processed.get(cacheKey);
  // Skip only if unchanged AND any mask it produced is still intact (5.3a).
  if (prev && prev.hash === h && (!prev.container || overlay.isIntact(prev.container))) return;

  if (paused || !matcher || matcher.isEmpty) {
    processed.set(cacheKey, { hash: h, container: null });
    return;
  }
  if (!matcher.test(text)) {
    processed.set(cacheKey, { hash: h, container: null });
    return;
  }
  const hit = matcher.match(text, Date.now());
  if (!hit) {
    processed.set(cacheKey, { hash: h, container: null });
    return;
  }

  const decision = findContainer(element, win);
  const container = decision.container;

  if (!container || isOwnNode(container)) {
    processed.set(cacheKey, { hash: h, container: null });
    if (!container) {
      log(`match term="${displayTerm(hit)}" text="${snippet(text)}"`);
      logRefused(decision); // no safe element at all (design 8b)
    }
    return;
  }

  // The user's Reveal wins until reload or Black out again (design 3.3): never
  // re-mask a story they revealed, identified by term + container text so it
  // holds across re-render or node replacement.
  if (isRevealed(storyKey(hit.term, container.textContent || ""))) {
    processed.set(cacheKey, { hash: h, container: null });
    return;
  }

  // Masks never nest (design 3.6 addendum): skip a match inside an already
  // masked element, and when masking one that contains inner masks remove those
  // first (exact restore), so one Reveal reveals the whole story.
  if (overlay.hasMaskedAncestor(container)) {
    processed.set(cacheKey, { hash: h, container: null });
    return;
  }
  for (const inner of overlay.masksWithin(container)) {
    overlay.cleanup(inner);
    activeContainers.delete(inner);
  }

  // Mask each container once: text, aria-label and title matches in the same
  // card resolve here and must produce a single mask and a single log line. A
  // match whose container is already masked and intact just refreshes the cache.
  const firstTime = !activeContainers.has(container);
  if (!firstTime && overlay.isIntact(container)) {
    processed.set(cacheKey, { hash: h, container });
    return;
  }

  const term = displayTerm(hit);
  log(`match term="${term}" text="${snippet(text)}"`);
  overlay.blackout(container, term, { window: win });
  overlay.reapply(container); // if a record existed but the page stripped it
  if (firstTime) {
    activeContainers.add(container);
    storyTerm.set(container, term);
    maskObserver.observe(container, { attributes: true, attributeFilter: ["class"], childList: true });
    countTerm(term); // one per masked story (design 3.6)
    recordBlocked(); // one distinct story blocked (FR-12)
  }
  processed.set(cacheKey, { hash: h, container });
  log(`container masked tag=${container.tagName} role="${roleOf(container)}" size=${sizeOf(container)}`);
}

/**
 * @param {Node} node
 */
function processNode(node) {
  const type = node.nodeType;
  if (type === 3) {
    const parent = node.parentElement;
    if (parent && isSkippable(parent, isOwnNode)) return; // e.g. text in <script>
    const text = node.nodeValue || "";
    if (text.trim()) {
      examinedText++;
      handleCandidate(node, parent, text);
    }
  } else if (type === 1) {
    if (isSkippable(node, isOwnNode)) return;
    const parts = [];
    for (const name of ATTRS) {
      const value = node.getAttribute(name);
      if (value) parts.push(value);
    }
    if (parts.length) {
      examinedAttrs += parts.length;
      handleCandidate(node, node, parts.join(" "));
    }
  }
}

/**
 * Drain the scan queue within the time budget; leftover work stays queued and
 * is picked up on the next flush (never dropped, design 5.3).
 * @returns {boolean} whether work remains
 */
function drain() {
  const start = perfNow();

  // Re-verify masked containers first: cheap, and keeps masks stuck as the feed
  // re-renders. Leftover carries to the next batch like scan work. In whole-page
  // mode there are no card masks to re-verify (design 3.6).
  while (reverifyQueue.length && perfNow() - start < MAX_BATCH_MS) {
    const container = reverifyQueue.shift();
    reverifyPending.delete(container);
    if (!pageMode.inWholePage() && activeContainers.has(container)) {
      // A user-revealed story is never re-masked, even though revealing removes
      // our class (design 3.3): don't let reverify read that as a page strip.
      if (isRevealed(storyKey(storyTerm.get(container) || "", container.textContent || ""))) continue;
      const outcome = reverify(container, matcher, win, activeContainers);
      if (outcome === "reapplied") log(`reverify reapplied tag=${container.tagName}`);
    }
  }

  while (perfNow() - start < MAX_BATCH_MS) {
    if (!active) {
      let root = null;
      while (pending.length) {
        const candidate = pending.shift();
        if (candidate && candidate.isConnected && !isOwnNode(candidate)) {
          root = candidate;
          break;
        }
      }
      if (!root) return false;
      active = makeWalker(root);
    }
    if (!active.rootDone) {
      active.rootDone = true;
      processNode(active.root);
      continue;
    }
    const node = active.walker.nextNode();
    if (!node) {
      active = null;
      continue;
    }
    processNode(node);
  }
  return pending.length > 0 || active != null || reverifyQueue.length > 0;
}

let flushTimer = null;
let lastFlushAt = 0;

function scheduleFlush() {
  if (flushTimer != null) return;
  const since = perfNow() - lastFlushAt;
  const wait = since >= MIN_INTERVAL_MS ? 0 : MIN_INTERVAL_MS - since;
  flushTimer = win.setTimeout(() => {
    flushTimer = null;
    lastFlushAt = perfNow();
    const more = drain();
    checkRule1(); // title may have arrived or changed since the last batch
    checkRule2(); // re-evaluate detected-story coverage after each batch
    if (more) scheduleFlush();
    else log(`scan examined textNodes=${examinedText} attrs=${examinedAttrs}`);
  }, wait);
}

/**
 * @param {Node} node
 */
function enqueue(node) {
  if (!node || isOwnNode(node)) return;
  pending.push(node);
}

function clearCardMasks() {
  for (const container of activeContainers) overlay.cleanup(container);
  activeContainers.clear();
  maskObserver.disconnect();
  reverifyQueue = [];
  reverifyPending = new WeakSet();
}

function teardownAll() {
  clearCardMasks();
  pageCover.uncoverPage();
  pageMode.reset();
  resetRevealed();
  storyTerm = new WeakMap();
  termInfo = new Map();
}

/** @param {string} term the include term as entered */
function countTerm(term) {
  const info = termInfo.get(term) || { count: 0 };
  info.count += 1;
  termInfo.set(term, info);
}

/**
 * Cover the whole page once. Whole-page and per-card blackout are either/or
 * (design 3.6): dropping into whole-page mode removes every existing card mask
 * (exact restore) and blocks any further card masking until reload.
 * @param {string} term
 */
function coverNow(term) {
  if (pageMode.inWholePage() || !term) return;
  pageMode.enterWholePage(activeContainers); // removes card masks, flips the mode
  maskObserver.disconnect();
  reverifyQueue = [];
  reverifyPending = new WeakSet();
  pageCover.coverPage(doc, term, { window: win }); // term is the only rendered text
  recordBlocked(); // a whole-page cover counts as one blocked story (FR-12)
  log(`page covered term="${term}"`);
}

/** Rule 1: title or URL search word matches a filter (design 3.6). */
function checkRule1() {
  if (pageMode.inWholePage() || paused || !matcher || matcher.isEmpty) return;
  const hit = ruleOneTerm(
    matcher,
    { title: doc.title || "", search: win.location.search || "" },
    Date.now(),
  );
  if (hit) {
    const term = displayTerm(hit);
    countTerm(term);
    coverNow(term);
  }
}

/** Rule 2: enough detected stories match (design 3.6). */
function checkRule2() {
  if (pageMode.inWholePage() || paused || !prefs) return;
  if (shouldCoverByStories(storyCounts(activeContainers), prefs)) {
    coverNow(mostMatchedTerm(termInfo));
  }
}

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === "childList") {
      for (const node of m.addedNodes) enqueue(node);
    } else if (m.type === "characterData") {
      enqueue(m.target);
    } else if (m.type === "attributes") {
      enqueue(m.target);
    }
    // Content recycled inside a masked card: re-verify it (new story may no
    // longer match, so the mask must be removed; design 5.3a).
    const masked = maskedAncestor(m.target);
    if (masked) enqueueReverify(masked);
  }
  scheduleFlush();
});

function startObserver() {
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    // Only the matchable attributes: class/style changes we make ourselves are
    // deliberately not observed, so we never react to our own writes.
    attributeFilter: ATTRS,
  });
}

function scanAll() {
  if (paused || !matcher || matcher.isEmpty || pageMode.inWholePage()) return;
  log("scan start");
  examinedText = 0;
  examinedAttrs = 0;
  enqueue(doc.body || doc.documentElement);
  scheduleFlush();
}

/** Distinct stories blocked on this page right now (whole-page cover is 1). */
function blockedCount() {
  return pageMode.inWholePage() ? 1 : activeContainers.size;
}

/** Add one distinct blocked story to the per-device counters (FR-12). */
function recordBlocked() {
  const today = new Date().toISOString().slice(0, 10);
  bumpCounter(today, 1).catch(() => {});
}

/** Recompute pause from per-device state; tear everything down while paused. */
async function refreshPause() {
  const device = await loadDeviceState();
  const next = isPaused(device, win.location.hostname || "");
  if (next === paused) return;
  paused = next;
  if (paused) teardownAll(); // remove masks and cover, exact restore
  else reevaluate();
}

async function reevaluate() {
  const [state, device] = await Promise.all([loadState(), loadDeviceState()]);
  prefs = state.preferences;
  paused = isPaused(device, win.location.hostname || "");
  matcher = compileMatcher(state.profiles);
  teardownAll();
  processed = new WeakMap();
  refusalLogged = new WeakSet();
  checkRule1();
  scanAll();
}

async function init() {
  const [state, device] = await Promise.all([loadState(), loadDeviceState()]);
  prefs = state.preferences;
  log(
    `profiles loaded: ${state.profiles.length}${state.seeded ? " (seeded starter profile)" : ""}`,
  );
  paused = isPaused(device, win.location.hostname || "");
  matcher = compileMatcher(state.profiles);

  startObserver();
  onStateChanged(reevaluate);
  onDeviceStateChanged(refreshPause); // popup pause toggles re-evaluate here

  // Answer the popup's "blocked on this page" request (design 3.1).
  const api = globalThis.browser ?? globalThis.chrome;
  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "blackout:count") {
        sendResponse({ available: true, count: blockedCount() });
      }
      return false;
    });
  }

  // Rule 1 at document_start, before first paint, so a matching search page
  // never flashes its results (design 3.6).
  checkRule1();

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", scanAll, { once: true });
  } else {
    scanAll();
  }
}

init();
