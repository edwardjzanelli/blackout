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
