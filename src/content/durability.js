// Mask durability (design 5.3a): feeds re-render, recycle and restyle nodes, so
// a mask is not "apply once and forget". reverify() re-checks a masked
// container and keeps it correct: re-apply if the page stripped our class or
// child, clean up if the node was removed or now holds non-matching content.

import { makeCandidateWalker, blockText } from "./scan.js";
import * as overlay from "./overlay.js";

const ATTRS = ["title", "aria-label", "alt"];

/**
 * True if node is (or lives inside) one of our injected elements, so the
 * matcher never reads our own label text.
 * @param {Node|null} node
 * @returns {boolean}
 */
function isOwn(node) {
  let el = node && node.nodeType === 3 ? node.parentNode : node;
  while (el && el.nodeType === 1) {
    if (el.id === "blackout-stylesheet") return true;
    if (el.classList && el.classList.contains("blackout-ui")) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * @param {Element} el
 * @param {import("./matcher.js").Matcher} matcher
 * @param {number} now
 * @returns {boolean}
 */
function attrsMatch(el, matcher, now) {
  const parts = [];
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (value) parts.push(value);
  }
  if (!parts.length) return false;
  const text = parts.join(" ");
  return matcher.test(text) && Boolean(matcher.match(text, now));
}

/**
 * Whether the container still holds any text or attribute that matches.
 * @param {Element} container
 * @param {import("./matcher.js").Matcher} matcher
 * @param {Window} win
 * @param {number} now
 * @returns {boolean}
 */
export function containerMatches(container, matcher, win, now) {
  if (!matcher || matcher.isEmpty) return false;
  // Test the container's rendered block text first (the shared extraction), so a
  // phrase that spans inline markup, a <br>/<wbr>, or adjacent block children
  // keeps its mask instead of being stripped because no single text node matches.
  const whole = blockText(container, isOwn);
  if (whole.trim() && matcher.test(whole) && matcher.match(whole, now)) return true;
  if (container.nodeType === 1 && attrsMatch(container, matcher, now)) return true;
  const walker = makeCandidateWalker(win.document, container, isOwn);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) {
      const text = node.nodeValue || "";
      if (text.trim() && matcher.test(text) && matcher.match(text, now)) return true;
    } else if (node.nodeType === 1 && attrsMatch(node, matcher, now)) {
      return true;
    }
  }
  return false;
}

/**
 * Re-check a masked container and keep it correct.
 * @param {Element} container
 * @param {import("./matcher.js").Matcher} matcher
 * @param {Window} win
 * @param {Set<Element>} active mutated: the container is removed if unmasked
 * @returns {"removed"|"reapplied"|"cleaned"|"intact"}
 */
export function reverify(container, matcher, win, active) {
  if (!container.isConnected) {
    overlay.cleanup(container);
    active.delete(container);
    return "removed";
  }
  if (containerMatches(container, matcher, win, Date.now())) {
    const wasIntact = overlay.isIntact(container);
    overlay.reapply(container);
    return wasIntact ? "intact" : "reapplied";
  }
  overlay.cleanup(container);
  active.delete(container);
  return "cleaned";
}
