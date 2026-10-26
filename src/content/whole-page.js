// Whole-page blackout decisions (design 3.6, FR-17). Pure logic, kept out of
// main.js so it is unit-testable: rule 1 (title / URL search word), rule 2
// (more than ten visible references), and which term labels the cover.

import { makeCandidateWalker, blockText, INLINE_TAGS } from "./scan.js";
import { isForbiddenBoundary } from "./container.js";

/** Attributes whose matches never count as a reference (design 3.6): they are
 * metadata, not text a person can see. Listed in the debug exclusions. */
const REF_ATTRS = ["title", "aria-label", "alt"];

/** @param {string} text @returns {string} first 60 chars, whitespace collapsed */
function snippet(text) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Rule 1: does the page title or any URL search word match an active filter?
 * Returns the matcher hit (with the include term as entered) or null.
 * @param {import("./matcher.js").Matcher} matcher
 * @param {{title?: string, search?: string}} page URL search string and title
 * @param {number} now
 * @returns {import("./matcher.js").Match|null}
 */
export function ruleOneTerm(matcher, page, now) {
  if (!matcher || matcher.isEmpty) return null;
  const params = new URLSearchParams(page.search || "");
  for (const value of params.values()) {
    const hit = matcher.match(value, now); // URLSearchParams already decodes
    if (hit) return hit;
  }
  const title = page.title || "";
  if (title) {
    const hit = matcher.match(title, now);
    if (hit) return hit;
  }
  return null;
}

/**
 * Rule 2 (design 3.6): cover when more than pageCoverMaxRefs references to
 * filter terms appear on the page. A reference is one element that owns a match;
 * see countReferences.
 * @param {number} refCount distinct reference elements seen so far
 * @param {{pageCoverMaxRefs?: number}} prefs
 * @returns {boolean}
 */
export function shouldCoverByRefs(refCount, prefs) {
  const max = typeof prefs.pageCoverMaxRefs === "number" ? prefs.pageCoverMaxRefs : 10;
  return refCount > max;
}

/**
 * Whether el is (or is inside) a field the user types into: an input, a textarea
 * or a contenteditable region (design 3.6 rule 5). Its text is never masked and
 * never counted; a matching suggestion dropdown lives outside the field and is
 * masked like any other content.
 * @param {Element} el
 * @returns {boolean}
 */
export function isInUserInput(el) {
  const host = el.closest && el.closest("input, textarea, [contenteditable]");
  if (!host) return false;
  const tag = host.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  const v = host.getAttribute("contenteditable");
  return v === "" || v === "true" || v === "plaintext-only";
}

/**
 * Why el's text is not visible to a person, judged by the page's own styling, or
 * null if it is visible (design 3.6 rule 2). Diskard's own mask is ignored, so a
 * reference we have masked still counts because it was visible before we covered
 * it. Layout-based checks (zero size, overflow clipping) only apply when a layout
 * engine is present (a real browser), not in jsdom.
 * @param {Element} el
 * @param {Window} win
 * @returns {string|null}
 */
export function hiddenReason(el, win) {
  const doc = win.document;
  if (!el.isConnected) return "detached";

  // A closed <details> hides everything except its own <summary>.
  for (
    let d = el.closest && el.closest("details:not([open])");
    d;
    d = d.parentElement && d.parentElement.closest && d.parentElement.closest("details:not([open])")
  ) {
    const summary = d.querySelector(":scope > summary");
    if (!summary || !summary.contains(el)) return "closed-details";
  }

  const maskRoot = el.closest ? el.closest(".blackout-blacked-out") : null;
  const hasLayout = doc.documentElement.getBoundingClientRect().height > 0;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const underMask = Boolean(maskRoot && maskRoot.contains(n)); // our mask, not the page's
    const st = win.getComputedStyle(n);
    if (st.display === "none") return "display-none";
    if (!underMask) {
      if (st.visibility === "hidden" || st.visibility === "collapse") return "visibility-hidden";
      if (parseFloat(st.opacity) === 0) return "opacity-0";
      if (hasLayout && n !== el && [st.overflow, st.overflowX, st.overflowY].some((v) => v === "hidden" || v === "clip")) {
        const er = el.getBoundingClientRect();
        const nr = n.getBoundingClientRect();
        if (er.right <= nr.left || er.left >= nr.right || er.bottom <= nr.top || er.top >= nr.bottom) return "clipped";
      }
    }
    if (n === doc.body) break;
  }

  if (hasLayout) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return "zero-size";
  }
  return null;
}

/**
 * Why a matching element is not a counted reference, or null if it counts. User
 * input and hidden text are excluded (design 3.6 rule 2, rule 5).
 * @param {Element} el
 * @param {Window} win
 * @returns {string|null}
 */
export function referenceExcludeReason(el, win) {
  if (isInUserInput(el)) return "input";
  return hiddenReason(el, win);
}

/**
 * Find the visible references to filter terms under root, and the matches that
 * were excluded (with the reason for each), so the count and the debug
 * explanation agree (design 3.6 rule 2). A reference is one element whose own
 * visible text matches; attribute matches (alt/aria-label/title) and hidden or
 * user-input text never count but are listed as excluded. Deepest matching block
 * only, so a wrapper is not double-counted. Our injected nodes never appear.
 * @param {Node} root
 * @param {import("./matcher.js").Matcher} matcher
 * @param {Window} win
 * @param {(node: Node) => boolean} [isOwn]
 * @param {number} [now]
 * @returns {{count: number, counted: {el: Element, snippet: string}[], excluded: {el: Element, reason: string, snippet: string}[]}}
 */
export function visibleReferences(root, matcher, win, isOwn, now = Date.now()) {
  const own = isOwn || (() => false);
  const counted = [];
  const excluded = [];
  if (!matcher || matcher.isEmpty) return { count: 0, counted, excluded };
  const matches = (t) => Boolean(t && t.trim() && matcher.test(t) && matcher.match(t, now));
  const childBlockMatches = (el) => {
    for (const c of el.children) {
      const tag = (c.tagName || "").toUpperCase();
      if (INLINE_TAGS.has(tag) || own(c)) continue;
      if (matches(blockText(c, own))) return true;
    }
    return false;
  };

  const walker = makeCandidateWalker(win.document, root, own);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 1) continue;
    const el = /** @type {Element} */ (node);
    if (own(el)) continue;

    // Attribute matches are metadata and never count; record them as excluded.
    for (const name of REF_ATTRS) {
      const v = el.getAttribute(name);
      if (v && matches(v)) excluded.push({ el, reason: name, snippet: snippet(v) });
    }

    // Visible text of the deepest matching block owns the reference.
    const tag = (el.tagName || "").toUpperCase();
    if (INLINE_TAGS.has(tag) || isForbiddenBoundary(el)) continue;
    const text = blockText(el, own);
    if (!matches(text) || childBlockMatches(el)) continue;
    const reason = referenceExcludeReason(el, win);
    if (reason) excluded.push({ el, reason, snippet: snippet(text) });
    else counted.push({ el, snippet: snippet(text) });
  }
  return { count: counted.length, counted, excluded };
}

/**
 * The number of visible references under root (design 3.6 rule 2). Thin wrapper
 * over visibleReferences for callers that only need the count.
 * @param {Node} root
 * @param {import("./matcher.js").Matcher} matcher
 * @param {Window} win
 * @param {(node: Node) => boolean} [isOwn]
 * @param {number} [now]
 * @returns {number}
 */
export function countReferences(root, matcher, win, isOwn, now = Date.now()) {
  return visibleReferences(root, matcher, win, isOwn, now).count;
}

/**
 * The include term with the highest match count on the page (design 3.6).
 * @param {Map<string, {count: number}>} termInfo
 * @returns {string|null}
 */
export function mostMatchedTerm(termInfo) {
  let best = null;
  let bestCount = -1;
  for (const [term, info] of termInfo) {
    if (info.count > bestCount) {
      best = term;
      bestCount = info.count;
    }
  }
  return best;
}
