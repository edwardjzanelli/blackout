// Candidate scanning (design 5.1): identify elements that hold visible,
// matchable text, and build a TreeWalker that skips everything else.

/** Elements whose text content is never visible page content. TITLE and DESC
 * cover both the HTML <title> and SVG <title>/<desc> metadata (tooltips, a11y
 * labels), which are not rendered in the page and must not be masked. */
export const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "DESC"]);

/**
 * Whether an element's subtree should be skipped when scanning for matches:
 * non-visible content (script/style/...) and the extension's own injected nodes.
 * SVG elements report a lower- or mixed-case tagName, so compare upper-cased.
 * @param {Element} el
 * @param {(node: Node) => boolean} [isOwnNode]
 * @returns {boolean}
 */
export function isSkippable(el, isOwnNode) {
  if (SKIP_TAGS.has((el.tagName || "").toUpperCase())) return true;
  return Boolean(isOwnNode && isOwnNode(el));
}

/**
 * Phrasing (inline) tags that do not end a phrase: a filter phrase may run
 * through them, so "Mirelle <b>Vossen</b>" is one phrase. Anything else (DIV,
 * P, LI, H1-6, custom feed elements, ...) is a block that bounds a phrase.
 */
export const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "CODE", "DATA", "DEL", "DFN",
  "EM", "FONT", "I", "INS", "KBD", "MARK", "NOBR", "Q", "RP", "RT", "RUBY",
  "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "TT", "U",
  "VAR", "WBR", "BIG",
]);

/**
 * The nearest block-level ancestor-or-self of el: climb while the element is an
 * inline/phrasing tag, so a phrase split across inline markup is matched against
 * the whole block's text, not one text node at a time (design 5.1, requirement:
 * phrases span inline element boundaries).
 * @param {Element|null} el
 * @returns {Element|null}
 */
export function nearestBlock(el) {
  let node = el;
  while (node && node.nodeType === 1 && INLINE_TAGS.has((node.tagName || "").toUpperCase())) {
    node = node.parentElement;
  }
  return node && node.nodeType === 1 ? node : el;
}

/** @param {Node} node @param {string[]} parts @param {(n: Node) => boolean} [isOwn] */
function collectText(node, parts, isOwn) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      parts.push(child.nodeValue || "");
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = (child.tagName || "").toUpperCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (isOwn && isOwn(child)) continue;
    if (tag === "BR" || tag === "WBR") {
      parts.push(" "); // a line/word break renders as whitespace
      continue;
    }
    // A block-level descendant renders on its own line: pad it so adjacent
    // blocks never run together. Inline descendants stay joined, so a word
    // split by inline markup ("Quen<b>dles</b>") reads as one word.
    const block = !INLINE_TAGS.has(tag);
    if (block) parts.push(" ");
    collectText(child, parts, isOwn);
    if (block) parts.push(" ");
  }
}

/**
 * The rendered text of an element for matching: text nodes concatenated, with a
 * space inserted at every boundary that renders as a break (a <br>/<wbr>, and
 * around every block-level descendant), so a phrase split by a break is matched
 * whole ("The<br>Quendles" and "<div>The</div><div>Quendles</div>" read as "The
 * Quendles") while an inline split inside a word stays joined. normalize()
 * collapses the inserted runs. The one extraction shared by scanning, the
 * reference count and re-verification.
 * @param {Element} root
 * @param {(node: Node) => boolean} [isOwn] true for the extension's own nodes
 * @returns {string}
 */
export function blockText(root, isOwn) {
  const parts = [];
  collectText(root, parts, isOwn);
  return parts.join("");
}

/**
 * A TreeWalker over elements and text nodes that rejects skippable subtrees.
 * @param {Document} doc
 * @param {Node} root
 * @param {(node: Node) => boolean} isOwnNode
 * @returns {TreeWalker}
 */
export function makeCandidateWalker(doc, root, isOwnNode) {
  const NF = doc.defaultView.NodeFilter;
  return doc.createTreeWalker(root, NF.SHOW_ELEMENT | NF.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1 && isSkippable(/** @type {Element} */ (node), isOwnNode)) {
        return NF.FILTER_REJECT;
      }
      return NF.FILTER_ACCEPT;
    },
  });
}
