// Whole-page blackout decisions (design 3.6, FR-17). Pure logic, kept out of
// main.js so it is unit-testable: rule 1 (title / URL search word), rule 2
// (enough detected stories match), and which term labels the cover.

import { repeatedGroup } from "./container.js";
import { makeCandidateWalker } from "./scan.js";

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
 * Count detected stories and how many matched. Detected stories are the
 * repeated-sibling card groups the masked containers belong to; a group's size
 * is all of its same-signature siblings (matched or not). Smallest-element
 * fallback masks (chips, headings) are not repeated items and do not count.
 * @param {Iterable<Element>} maskedContainers
 * @returns {{total: number, matched: number}}
 */
export function storyCounts(maskedContainers) {
  /** @type {Map<Element, Map<string, {size: number, matched: number}>>} */
  const byParent = new Map();
  for (const container of maskedContainers) {
    const group = repeatedGroup(container);
    if (!group) continue;
    let bySig = byParent.get(group.parent);
    if (!bySig) {
      bySig = new Map();
      byParent.set(group.parent, bySig);
    }
    let entry = bySig.get(group.signature);
    if (!entry) {
      entry = { size: group.size, matched: 0 };
      bySig.set(group.signature, entry);
    }
    entry.size = group.size;
    entry.matched += 1;
  }

  let total = 0;
  let matched = 0;
  for (const bySig of byParent.values()) {
    for (const entry of bySig.values()) {
      total += entry.size;
      matched += entry.matched;
    }
  }
  return { total, matched };
}

/**
 * Rule 2, first half: cover when more than pageCoverRatio of detected stories
 * match and at least pageCoverMinMatches do (design 3.6).
 * @param {{total: number, matched: number}} counts
 * @param {{pageCoverRatio?: number, pageCoverMinMatches?: number}} prefs
 * @returns {boolean}
 */
export function shouldCoverByStories(counts, prefs) {
  const ratio = typeof prefs.pageCoverRatio === "number" ? prefs.pageCoverRatio : 0.5;
  const min = typeof prefs.pageCoverMinMatches === "number" ? prefs.pageCoverMinMatches : 6;
  return counts.matched >= min && counts.matched > counts.total * ratio;
}

/**
 * Rule 2, second half (design 3.6): cover when more than pageCoverMaxRefs
 * references to filter terms appear on the page, even if no cards were
 * recognised. A reference is one element that owns a match; see countReferences.
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
  const owners = new Set();
  const walker = makeCandidateWalker(win.document, root, isOwn || (() => false));
  let node;
  while ((node = walker.nextNode())) {
    let owner = null;
    let text = "";
    if (node.nodeType === 3) {
      owner = node.parentElement;
      text = node.nodeValue || "";
    } else if (node.nodeType === 1) {
      owner = /** @type {Element} */ (node);
      text = REF_ATTRS.map((a) => owner.getAttribute(a)).filter(Boolean).join(" ");
    }
    if (!owner || !text.trim()) continue;
    if (isOwn && isOwn(owner)) continue;
    if (matcher.test(text) && matcher.match(text, now)) owners.add(owner);
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
