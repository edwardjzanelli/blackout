// Whole-page blackout decisions (design 3.6, FR-17). Pure logic, kept out of
// main.js so it is unit-testable: rule 1 (title / URL search word), rule 2
// (more than ten visible references), and which term labels the cover.

import { makeCandidateWalker, nearestBlock, blockText } from "./scan.js";

/** Attributes that carry matchable text and so make an element a reference. */
const REF_ATTRS = ["title", "aria-label", "alt"];

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
 * Count references to filter terms under root: distinct elements that own a
 * match in their own text or in a title/aria-label/alt attribute. Each element
 * counts once even if several of its attributes (and its text) match. Our own
 * injected nodes never count. This is the spec the content script mirrors
 * incrementally as it scans (design 3.6 rule 2).
 * @param {Node} root
 * @param {import("./matcher.js").Matcher} matcher
 * @param {Window} win
 * @param {(node: Node) => boolean} [isOwn] true for the extension's own nodes
 * @param {number} [now]
 * @returns {number}
 */
export function countReferences(root, matcher, win, isOwn, now = Date.now()) {
  if (!matcher || matcher.isEmpty) return 0;
  const own = isOwn || (() => false);
  const owners = new Set();
  const testedBlocks = new Set();
  const walker = makeCandidateWalker(win.document, root, own);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) {
      // Count the text's nearest block once, matched on its rendered block text
      // (the shared extraction), so a reference split across inline markup or a
      // break still counts.
      const block = nearestBlock(node.parentElement);
      if (!block || own(block) || testedBlocks.has(block)) continue;
      testedBlocks.add(block);
      const text = blockText(block, own);
      if (text.trim() && matcher.test(text) && matcher.match(text, now)) owners.add(block);
    } else if (node.nodeType === 1) {
      const owner = /** @type {Element} */ (node);
      if (own(owner)) continue;
      const attrs = REF_ATTRS.map((a) => owner.getAttribute(a)).filter(Boolean).join(" ");
      if (attrs.trim() && matcher.test(attrs) && matcher.match(attrs, now)) owners.add(owner);
    }
  }
  return owners.size;
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
