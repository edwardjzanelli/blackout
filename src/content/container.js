// Container resolver (design 5.1, 8b): from a matched node, walk up to the
// smallest safe content unit. Refuse page-structure elements, oversized
// elements, and anything holding form inputs. No safe container means skip the
// match and mask nothing.

/** Content units we are willing to black out. */
const CONTENT_UNIT_SELECTOR = 'article, [role="article"], li';

/** Tags that are never a safe content unit. */
const UNSAFE_TAGS = new Set(["BODY", "HTML", "MAIN", "NAV", "HEADER", "FOOTER"]);

/** ARIA roles that are never a safe content unit. */
const UNSAFE_ROLES = new Set(["feed", "main", "navigation"]);

/** Fraction of the viewport above which an element is too big to mask. */
const MAX_VIEWPORT_FRACTION = 0.6;

/** Heuristic for a card-like block when there is no article/li/[role=article]. */
const CARD_CLASS_RE = /(?:^|[-_ ])(?:card|post|tile|story|item|cell|entry)(?:[-_ ]|$)/i;

/** How many same-signature siblings make a parent a repeated-item list. */
const MIN_REPEATED_SIBLINGS = 3;

/** Our own mask class, excluded from signatures so masking one card does not
 * change its signature and hide its still-unmasked siblings from the rule. */
const OWN_CLASS = "blackout-blacked-out";

/**
 * Why an element is unsafe to cover, or null if it is safe: holds no form
 * inputs and is not larger than MAX_VIEWPORT_FRACTION of the viewport.
 * @param {Element} el
 * @param {Window} win
 * @returns {"contains-inputs"|"too-large"|null}
 */
function safetyReason(el, win) {
  if (el.querySelector("input, textarea, select")) return "contains-inputs";
  const vw = win.innerWidth || 0;
  const vh = win.innerHeight || 0;
  if (vw > 0 && vh > 0 && typeof el.getBoundingClientRect === "function") {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > MAX_VIEWPORT_FRACTION * vw * vh) return "too-large";
  }
  return null;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
function isCardLike(el) {
  if (el.tagName !== "DIV" && el.tagName !== "SECTION") return false;
  return CARD_CLASS_RE.test(el.getAttribute("class") || "");
}

/**
 * A tag + sorted-class-list signature, so sibling cards that share the same
 * (obfuscated) markup compare equal.
 * @param {Element} el
 * @returns {string}
 */
function signature(el) {
  const classes = (el.getAttribute("class") || "")
    .trim()
    .split(/\s+/)
    .filter((c) => c && c !== OWN_CLASS)
    .sort();
  return `${el.tagName}|${classes.join(" ")}`;
}

/**
 * True if el is one of at least MIN_REPEATED_SIBLINGS children of its parent
 * sharing its signature, i.e. an item in a repeated list (a feed of cards).
 * @param {Element} el
 * @returns {boolean}
 */
function isRepeatedItem(el) {
  const parent = el.parentElement;
  if (!parent) return false;
  const sig = signature(el);
  let count = 0;
  for (const child of parent.children) {
    if (signature(child) === sig && ++count >= MIN_REPEATED_SIBLINGS) return true;
  }
  return false;
}

/**
 * If el is a repeated-list item (a detected story, design 3.6), return its
 * group: the parent, the shared signature, and the total number of siblings
 * sharing it (counting masked siblings, since the signature ignores our class).
 * @param {Element} el
 * @returns {{parent: Element, signature: string, size: number}|null}
 */
export function repeatedGroup(el) {
  const parent = el.parentElement;
  if (!parent) return null;
  const sig = signature(el);
  let size = 0;
  for (const child of parent.children) {
    if (signature(child) === sig) size++;
  }
  return size >= MIN_REPEATED_SIBLINGS ? { parent, signature: sig, size } : null;
}

/**
 * @typedef {Object} ContainerDecision
 * @property {Element|null} container the element to mask, or null to skip
 * @property {"chosen"|"smallest"|"too-large"|"contains-inputs"|"forbidden-tag"|"forbidden-role"|"no-candidate"} reason
 * @property {Element|null} element the chosen or offending element, for logging
 */

/** @param {Element} el @returns {ContainerDecision} */
function chose(el) {
  return { container: el, reason: "chosen", element: el };
}

/**
 * @param {ContainerDecision["reason"]} reason
 * @param {Element|null} el
 * @returns {ContainerDecision}
 */
function refused(reason, el) {
  return { container: null, reason, element: el };
}

/**
 * Find the smallest safe content unit containing startNode. Returns the choice
 * and the reason, so callers can log why a match was or was not masked.
 *
 * Preference order while walking up to the first refused boundary: the nearest
 * explicit content unit (article/li/[role=article]); else the nearest card-like
 * block by class name; else the highest repeated-list item (a card in a feed of
 * same-signature siblings, which is how obfuscated sites like Google News mark
 * their cards); else the smallest safe element containing the match (its own
 * link, chip, heading or span), so a matched word is never left visible
 * (design 8b). Every ancestor below the boundary is evaluated before refusing;
 * refusal only happens when even the matched element is a forbidden boundary or
 * otherwise unsafe.
 * @param {Node} startNode
 * @param {Window} [win]
 * @returns {ContainerDecision}
 */
export function findContainer(startNode, win = globalThis) {
  const doc = win.document || (startNode.ownerDocument ?? document);
  let el = startNode.nodeType === 3 ? startNode.parentElement : /** @type {Element} */ (startNode);

  /** Nearest safe card-like block by class name. */
  let cardLike = null;
  /** Highest safe repeated-list item seen below the boundary. */
  let repeated = null;
  /** Smallest safe element containing the match (the nearest safe ancestor). */
  let smallest = null;

  while (el && el !== doc.documentElement) {
    if (UNSAFE_TAGS.has(el.tagName)) {
      return finalize(cardLike, repeated, smallest, "forbidden-tag", el);
    }
    const role = (el.getAttribute("role") || "").trim().toLowerCase();
    if (role && UNSAFE_ROLES.has(role)) {
      return finalize(cardLike, repeated, smallest, "forbidden-role", el);
    }
    if (el.matches(CONTENT_UNIT_SELECTOR)) {
      // Nearest explicit unit: use it if safe, otherwise a bigger ancestor is
      // only worse, so stop with whatever generic candidate we have found.
      const reason = safetyReason(el, win);
      if (!reason) return chose(el);
      return finalize(cardLike, repeated, smallest, reason, el);
    }
    if (!safetyReason(el, win)) {
      if (!smallest) smallest = el; // nearest safe element = smallest
      if (!cardLike && isCardLike(el)) cardLike = el;
      if (isRepeatedItem(el)) repeated = el; // overwrite: ends as the highest
    }
    el = el.parentElement;
  }
  return finalize(cardLike, repeated, smallest, "no-candidate", null);
}

/**
 * Pick the container: a card if one was found (class-named cards are a nearer,
 * more specific signal than a repeated-item, so they win when both exist);
 * else the smallest safe element so the match is masked rather than left
 * visible; else refuse (no safe element exists below the boundary).
 * @param {Element|null} cardLike
 * @param {Element|null} repeated
 * @param {Element|null} smallest
 * @param {ContainerDecision["reason"]} reason
 * @param {Element|null} boundary
 * @returns {ContainerDecision}
 */
function finalize(cardLike, repeated, smallest, reason, boundary) {
  const card = cardLike || repeated;
  if (card) return chose(card);
  if (smallest) return { container: smallest, reason: "smallest", element: smallest };
  return refused(reason, boundary);
}
