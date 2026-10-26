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
import { findContainer, isForbiddenBoundary } from "./container.js";
import { makeCandidateWalker, isSkippable, nearestBlock, blockText, INLINE_TAGS } from "./scan.js";
import { reverify } from "./durability.js";
import {
  ruleOneTerm,
  storyCounts,
  shouldCoverByStories,
  shouldCoverByRefs,
  mostMatchedTerm,
} from "./whole-page.js";
import { watchNavigation } from "./navwatch.js";
import { hasExtensionApis } from "../shared/browser.js";
import { unitSelectorFor } from "../adapters/index.js";
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
/** The active site adapter's content-unit selectors (design 5.4), or "". */
let unitSelectors = "";

/**
 * References to filter terms seen so far (design 3.6 rule 2): distinct elements
 * that own a match. Each element counts once; our own nodes never count. Only
 * grows while scanning, so the cover never flips back mid-scroll.
 */
let refElements = new WeakSet();
let refCount = 0;

/** Cleanup for the in-page navigation watch (SPA URL changes). */
let navCleanup = null;

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

  // This element owns a match: count it once as a reference (design 3.6 rule 2),
  // whatever happens to its container below, and tally its term for the cover
  // label.
  countReference(element, displayTerm(hit));

  const decision = findContainer(element, win, unitSelectors);
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
    recordBlocked(); // one distinct story blocked (FR-12)
  }
  processed.set(cacheKey, { hash: h, container });
  log(`container masked tag=${container.tagName} role="${roleOf(container)}" size=${sizeOf(container)}`);
}

/**
 * @param {Node} node
 */
function processNode(node) {
  // Text nodes are matched through their block (see enqueue): a phrase split by
  // inline markup, a <br>/<wbr>, or adjacent block children must be read whole,
  // which a single text node cannot give. Only elements are processed here.
  if (node.nodeType !== 1) return;
  if (isSkippable(node, isOwnNode)) return;

  // Attribute text (title/aria-label/alt) belongs to this element alone.
  const parts = [];
  for (const name of ATTRS) {
    const value = node.getAttribute(name);
    if (value) parts.push(value);
  }
  if (parts.length) {
    examinedAttrs += parts.length;
    handleCandidate(node, node, parts.join(" "));
  }

  // Block-level elements carry matchable rendered text. Read the block's text
  // (inline splits joined; <br>/<wbr> and nested block boundaries spaced) so a
  // phrase is matched whole. Skip inline elements (their text is part of their
  // block) and page-structure boundaries (never a mask target; reading their
  // whole text would be costly and the cards inside are read on their own).
  const tag = (node.tagName || "").toUpperCase();
  if (!INLINE_TAGS.has(tag) && !isForbiddenBoundary(node)) {
    const text = blockText(node, isOwnNode);
    if (text.trim() && blockMatches(text)) {
      examinedText++;
      // Mask at the deepest matching block: if a child block also matches, let
      // it handle the match, so we never mask a wrapper larger than the phrase
      // (the match spans this block's children only when no child matches alone).
      if (!childBlockMatches(node)) handleCandidate(node, node, text);
    }
  }
}

/** @param {string} text @returns {boolean} whether the active matcher hits */
function blockMatches(text) {
  return Boolean(matcher && !matcher.isEmpty && matcher.test(text) && matcher.match(text, Date.now()));
}

/** Whether any child block element of el matches on its own rendered text. */
function childBlockMatches(el) {
  for (const child of el.children) {
    const tag = (child.tagName || "").toUpperCase();
    if (INLINE_TAGS.has(tag) || isSkippable(child, isOwnNode)) continue;
    const text = blockText(child, isOwnNode);
    if (text.trim() && blockMatches(text)) return true;
  }
  return false;
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
  // A changed text node is matched through its block, so enqueue the block (its
  // subtree is walked and every block in it processed).
  if (node.nodeType === 3) {
    const block = nearestBlock(node.parentElement);
    if (block && !isOwnNode(block)) pending.push(block);
    return;
  }
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
  refElements = new WeakSet();
  refCount = 0;
}

/** @param {string} term the include term as entered */
function countTerm(term) {
  const info = termInfo.get(term) || { count: 0 };
  info.count += 1;
  termInfo.set(term, info);
}

/**
 * Count one reference to a filter term (design 3.6 rule 2): the owning element,
 * once, and its term for the cover label. Only grows, so the cover never flips
 * back as the page scrolls.
 * @param {Element|null} element the element that owns the match
 * @param {string} term the include term as entered
 */
function countReference(element, term) {
  if (!element || refElements.has(element)) return;
  refElements.add(element);
  refCount += 1;
  if (term) countTerm(term);
}

/**
 * Cover the whole page once. Whole-page and per-card blackout are either/or
 * (design 3.6): dropping into whole-page mode removes every existing card mask
 * (exact restore) and blocks any further card masking until reload.
 * @param {string} term
 * @param {"1"|"2a"|"2b"} rule which §3.6 rule fired (for the debug explanation)
 */
function coverNow(term, rule) {
  if (pageMode.inWholePage() || !term) return;
  // Gather the full cover explanation while the per-card state is still intact
  // (enterWholePage clears activeContainers below). Debug build only.
  /* @debug-only:start */
  const coverNote = explainCover(rule, term);
  /* @debug-only:end */
  pageMode.enterWholePage(activeContainers); // removes card masks, flips the mode
  maskObserver.disconnect();
  reverifyQueue = [];
  reverifyPending = new WeakSet();
  pageCover.coverPage(doc, term, { window: win }); // term is the only rendered text
  recordBlocked(); // a whole-page cover counts as one blocked story (FR-12)
  log(`page covered term="${term}"`);
  /* @debug-only:start */
  annotateCover(coverNote);
  /* @debug-only:end */
}

/* @debug-only:start */
/**
 * Explain exactly why the whole page was covered (design review, Ed's ruling):
 * log one [blackout] block with the rule that fired, the thresholds in force,
 * and the counts for all three rules so the margin is visible. Returns a short
 * note shown on the cover itself. Debug build only (stripped from normal builds).
 * @param {"1"|"2a"|"2b"} rule
 * @param {string} term
 * @returns {string}
 */
function explainCover(rule, term) {
  const now = Date.now();
  const ratio = prefs.pageCoverRatio;
  const min = prefs.pageCoverMinMatches;
  const max = prefs.pageCoverMaxRefs;
  const stories = storyCounts(activeContainers);
  const r1 = ruleOneWithSource(now);
  const refs = gatherReferences(now);
  const blocks = new Set(refs.map((r) => r.container).filter(Boolean));

  log(`==== whole-page cover: rule ${rule} fired (term="${term}") ====`);
  log(`thresholds: pageCoverRatio=${ratio} pageCoverMinMatches=${min} pageCoverMaxRefs=${max}`);
  log(
    `rule 1 (title/URL): ${r1 ? `MATCH term="${r1.term}" via ${r1.source}="${snippet(r1.value)}"` : "no match"}`,
  );
  log(
    `rule 2a (story share): detected=${stories.total} matching=${stories.matched} ` +
      `fires=${shouldCoverByStories(stories, prefs)} (needs matching>=${min} AND matching>${ratio}*detected)`,
  );
  for (const c of activeContainers) {
    log(`  2a matching story: ${describeEl(c)} "${snippet(blockText(c, isOwnNode))}"`);
  }
  log(
    `rule 2b (references): count=${refCount} fires=${shouldCoverByRefs(refCount, prefs)} (needs >${max})`,
  );
  for (const r of refs) {
    log(`  2b ref: <${r.tag}> where=${r.where} term="${r.term}" block#${r.blockIdx} "${r.snippet}"`);
  }
  log(`rule 2b alternative: distinct visible blocks (masked units) = ${blocks.size}`);
  log(`(gathered references=${refs.length}; live refCount=${refCount})`);
  log(`==== end cover explanation ====`);

  if (rule === "1") return `debug: rule 1, title/URL "${r1 ? r1.term : term}"`;
  if (rule === "2a") return `debug: rule 2a, ${stories.matched}/${stories.total} stories match`;
  return `debug: rule 2b, ${refCount} references > ${max} (${blocks.size} visible blocks)`;
}

/** Rule 1 match with its source (which URL param, or the title). */
function ruleOneWithSource(now) {
  const params = new URLSearchParams(win.location.search || "");
  for (const [key, value] of params) {
    const hit = matcher.match(value, now);
    if (hit) return { term: displayTerm(hit), source: `url:${key}`, value };
  }
  const title = doc.title || "";
  const hit = title && matcher.match(title, now);
  return hit ? { term: displayTerm(hit), source: "title", value: title } : null;
}

/** Re-gather references with detail, mirroring the live scan (deepest matching
 * block for text, plus attribute matches), each tagged with its visible block
 * (the container findContainer would mask). */
function gatherReferences(now) {
  const seen = new Set();
  const containerIdx = new Map();
  const out = [];
  const walker = makeCandidateWalker(doc, doc.body, isOwnNode);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 1) continue;
    const el = /** @type {Element} */ (node);
    if (seen.has(el)) continue;
    const tag = (el.tagName || "").toUpperCase();
    let where = null;
    let text = "";
    for (const name of ATTRS) {
      const v = el.getAttribute(name);
      if (v && matcher.test(v) && matcher.match(v, now)) {
        where = name;
        text = v;
        break;
      }
    }
    if (!where && !INLINE_TAGS.has(tag) && !isForbiddenBoundary(el)) {
      const bt = blockText(el, isOwnNode);
      if (bt.trim() && blockMatches(bt) && !childBlockMatches(el)) {
        where = "text";
        text = bt;
      }
    }
    if (!where) continue;
    seen.add(el);
    const container = findContainer(el, win, unitSelectors).container;
    if (container && !containerIdx.has(container)) containerIdx.set(container, containerIdx.size);
    const hit = matcher.match(text, now);
    out.push({
      tag: el.tagName.toLowerCase(),
      where,
      term: hit ? displayTerm(hit) : "",
      snippet: snippet(text),
      container,
      blockIdx: container ? containerIdx.get(container) : -1,
    });
  }
  return out;
}

/** @param {Element} el short tag[role] description */
function describeEl(el) {
  const role = roleOf(el);
  return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}`;
}

/** Append the short cover explanation to the cover itself (debug only). */
function annotateCover(note) {
  const host = doc.getElementById("blackout-page-cover");
  const root = host && pageCover.shadowRootFor(host);
  const cover = root && root.querySelector(".cover");
  if (!cover) return;
  const p = doc.createElement("p");
  p.textContent = note;
  p.style.cssText = "font-size:11px;opacity:0.7;margin:6px 0 0";
  cover.appendChild(p);
}
/* @debug-only:end */

/**
 * Debug-only escape hatch so a live check can exercise per-card masking on pages
 * that would otherwise be covered whole (scripts/live-check.mjs --no-page-rule).
 * Gated behind DEBUG, so a normal build never reads it (design 3.6).
 * @returns {boolean}
 */
function pageRulesDisabled() {
  /* @debug-only:start */
  try {
    if (win.localStorage.getItem("blackout:no-page-rule") === "1") return true;
  } catch {
    // localStorage may be unavailable; fall through.
  }
  /* @debug-only:end */
  return false;
}

/** Rule 1: title or URL search word matches a filter (design 3.6). */
function checkRule1() {
  if (pageMode.inWholePage() || paused || !matcher || matcher.isEmpty || pageRulesDisabled()) return;
  const hit = ruleOneTerm(
    matcher,
    { title: doc.title || "", search: win.location.search || "" },
    Date.now(),
  );
  if (hit) {
    const term = displayTerm(hit);
    countTerm(term);
    coverNow(term, "1");
  }
}

/** Rule 2: enough detected stories match (2a), or enough references appear (2b)
 * (design 3.6). 2a is checked first so the rule that actually fires is reported. */
function checkRule2() {
  if (pageMode.inWholePage() || paused || !prefs || pageRulesDisabled()) return;
  if (shouldCoverByStories(storyCounts(activeContainers), prefs)) {
    coverNow(mostMatchedTerm(termInfo), "2a");
  } else if (shouldCoverByRefs(refCount, prefs)) {
    coverNow(mostMatchedTerm(termInfo), "2b");
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
  unitSelectors = unitSelectorFor(win.location.hostname || "");
  matcher = compileMatcher(state.profiles);
  teardownAll();
  processed = new WeakMap();
  refusalLogged = new WeakSet();
  checkRule1();
  scanAll();
}

/**
 * An in-page navigation changed the URL without a document load (SPAs, design
 * 5.3a/5.4). Facebook reaches its search results this way and its only match
 * signal is the ?q= in the URL, so rule 1 must be re-evaluated against the new
 * URL. Drop any cover or masks with an exact restore, forget processed nodes,
 * then re-decide rule 1 and re-scan: this covers a newly-matching page and
 * leaves whole-page mode when the new page no longer qualifies (design 3.6).
 */
function onUrlChange() {
  if (paused) return;
  unitSelectors = unitSelectorFor(win.location.hostname || "");
  teardownAll();
  processed = new WeakMap();
  refusalLogged = new WeakSet();
  log("in-page navigation; re-evaluating");
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
  unitSelectors = unitSelectorFor(win.location.hostname || "");
  matcher = compileMatcher(state.profiles);

  startObserver();
  onStateChanged(reevaluate);
  onDeviceStateChanged(refreshPause); // popup pause toggles re-evaluate here
  if (!navCleanup) navCleanup = watchNavigation(win, onUrlChange); // SPA URL changes

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

// Only run inside a real extension context. If a web page imports this module
// from web_accessible_resources, the extension APIs are absent, so init() never
// runs: no observers, no listeners, no DOM changes (defense in depth, design 9).
if (hasExtensionApis()) init();
