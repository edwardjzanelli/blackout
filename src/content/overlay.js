// Overlay (design 8a): black out a container by styling it, not covering it.
// An injected stylesheet blacks the container's background and hides every
// child; one injected child, isolated in a shadow root, carries the label and
// the Reveal / Black out again control. Cleanup restores the page exactly.

import { storyKey, markRevealed, clearRevealed } from "./revealed.js";

const BLACKED_CLASS = "blackout-blacked-out";
const UI_CLASS = "blackout-ui";
const STYLE_ID = "blackout-stylesheet";
const STATE_ATTR = "data-blackout-state";

/** Minimum masked-element height so the 24px Reveal button is never clipped. */
const MIN_MASK_HEIGHT = 28;

const DOCUMENT_CSS = `
.${BLACKED_CLASS} {
  background-color: #000 !important;
}
.${BLACKED_CLASS} > :not(.${UI_CLASS}) {
  visibility: hidden !important;
}
.${UI_CLASS} {
  z-index: 2147483647;
  visibility: visible !important;
  pointer-events: auto !important;
}
.${UI_CLASS}[${STATE_ATTR}="blacked-out"] {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Make the host a size query container so the shadow UI can adapt to the
     masked element's height and width (design 8c), no JS layout loop. */
  container-type: size;
}
.${UI_CLASS}[${STATE_ATTR}="revealed"] {
  position: absolute;
  top: 4px;
  right: 4px;
}
`;

// Mobile-first: the smallest layout is the Reveal button alone. Container
// queries progressively add the term, then the full stacked label, as the
// masked element gets taller/wider. Reveal (and "Black out again") is never
// dropped and keeps a 24px minimum clickable height (design 8c).
const SHADOW_CSS = `
:host { all: initial; }
.panel {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  padding: 2px 6px;
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #fff;
  text-align: center;
  overflow: hidden;
}
.label,
.profile {
  display: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label { font-weight: 600; }
.profile { opacity: 0.9; }
button {
  flex: none;
  font: inherit;
  cursor: pointer;
  min-height: 24px;
  padding: 2px 10px;
  border: 1px solid #fff;
  border-radius: 4px;
  background: #222;
  color: #fff;
  white-space: nowrap;
}
button:hover { background: #333; }
button:focus-visible { outline: 2px solid #4aa3ff; outline-offset: 2px; }
:host([${STATE_ATTR}="revealed"]) button { background: rgba(0, 0, 0, 0.75); }

/* Room beside the button: one row of term + Reveal (drop the long label). */
@container (min-width: 140px) and (min-height: 30px) {
  .profile { display: inline-block; }
}
/* Tall and wide enough: the full stacked layout. */
@container (min-width: 160px) and (min-height: 92px) {
  .panel { flex-direction: column; gap: 6px; padding: 8px 12px; }
  .label { display: block; }
  .profile { display: block; }
}
`;

/**
 * @typedef {Object} OverlayRecord
 * @property {HTMLElement} host
 * @property {HTMLButtonElement} button
 * @property {boolean} positionChanged
 * @property {string} prevInlinePosition
 * @property {boolean} minHeightNeeded whether we grew the element for the button
 * @property {string} prevInlineMinHeight
 * @property {string} term matched include term, for revealed-story identity
 */

/** @type {WeakMap<Element, OverlayRecord>} */
const overlays = new WeakMap();

/** Pointer/mouse/touch events whose default (navigation, selection) we cancel. */
const POINTER_EVENTS = ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"];

/**
 * Make an injected host swallow interaction so it never reaches the page: in
 * the capture phase cancel the default action (so an enclosing <a> never
 * navigates), and in the bubble phase stop the event leaving the host (so page
 * click handlers never fire). Keyboard activation still reaches the button, so
 * keydown/keyup are only stopped, never default-cancelled. Shared by the card
 * mask and the whole-page cover (design 3.3, 8a, 3.6).
 * @param {HTMLElement} host
 */
export function armSwallow(host) {
  for (const type of POINTER_EVENTS) {
    host.addEventListener(type, (e) => e.preventDefault(), true);
    host.addEventListener(type, (e) => e.stopPropagation(), false);
  }
  for (const type of ["keydown", "keyup"]) {
    host.addEventListener(type, (e) => e.stopPropagation(), false);
  }
}

/**
 * Whether any ancestor of container is already masked (design 3.6 addendum:
 * masks must never nest).
 * @param {Element} container
 * @returns {boolean}
 */
export function hasMaskedAncestor(container) {
  for (let el = container.parentElement; el; el = el.parentElement) {
    if (overlays.has(el)) return true;
  }
  return false;
}

/**
 * The masked containers strictly inside container (to remove before masking it,
 * so masks never nest; design 3.6 addendum).
 * @param {Element} container
 * @returns {Element[]}
 */
export function masksWithin(container) {
  const inner = [];
  for (const host of container.querySelectorAll(`.${UI_CLASS}`)) {
    const masked = host.parentElement;
    if (masked && masked !== container && overlays.has(masked)) inner.push(masked);
  }
  return inner;
}

/**
 * Inject the shared document stylesheet once.
 * @param {Document} doc
 */
export function ensureStylesheet(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DOCUMENT_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

/**
 * @param {Element} container
 * @returns {boolean}
 */
export function isBlackedOut(container) {
  return overlays.has(container);
}

/**
 * Whether the mask is still fully applied: we have a record, our class is on
 * the container, and our injected child is still its descendant. The page can
 * strip either while re-rendering (design 5.3a).
 * @param {Element} container
 * @returns {boolean}
 */
export function isIntact(container) {
  const record = overlays.get(container);
  if (!record) return false;
  return container.classList.contains(BLACKED_CLASS) && container.contains(record.host);
}

/**
 * Re-apply a mask the page partly removed: restore our class and re-attach our
 * injected child. No-op if intact or unknown.
 * @param {Element} container
 */
export function reapply(container) {
  const record = overlays.get(container);
  if (!record) return;
  if (!container.classList.contains(BLACKED_CLASS)) container.classList.add(BLACKED_CLASS);
  if (!container.contains(record.host)) container.appendChild(record.host);
}

/**
 * Black out a container.
 * @param {Element} container
 * @param {string} term the matched include term, as entered: shown on the label
 *   (design 3.3) and used to track a Reveal by story identity
 * @param {{window?: Window}} [options]
 * @returns {OverlayRecord}
 */
export function blackout(container, term, options = {}) {
  const existing = overlays.get(container);
  if (existing) {
    if (term) existing.term = term; // node reused for a new story
    return existing;
  }

  const doc = container.ownerDocument;
  const win = options.window || doc.defaultView || globalThis;
  ensureStylesheet(doc);

  // Only inline change allowed on page elements: position: relative, and only
  // when the label needs a positioned ancestor. Record the previous value.
  const prevInlinePosition = container.style.position;
  let positionChanged = false;
  const computed = win.getComputedStyle ? win.getComputedStyle(container).position : "";
  if (!["relative", "absolute", "fixed", "sticky"].includes(computed)) {
    container.style.position = "relative";
    positionChanged = true;
  }

  // The one accepted layout change (design 8c): if the element is too short for
  // the Reveal button, grow its min-height just enough while masked. Recorded,
  // and restored exactly on Reveal and cleanup.
  const prevInlineMinHeight = container.style.minHeight;
  let minHeightNeeded = false;
  const applyMinHeight = () => {
    if (minHeightNeeded) container.style.setProperty("min-height", `${MIN_MASK_HEIGHT}px`);
  };
  const restoreMinHeight = () => {
    if (!minHeightNeeded) return;
    if (prevInlineMinHeight) container.style.minHeight = prevInlineMinHeight;
    else container.style.removeProperty("min-height");
  };

  const host = doc.createElement("div");
  host.className = UI_CLASS;
  host.setAttribute(STATE_ATTR, "blacked-out");
  // Make the host the topmost clickable thing inside the masked element on any
  // site: its own stacking context (isolation) at the maximum z-index, set
  // inline so page CSS cannot lower it (design 3.3, 8a).
  host.style.setProperty("z-index", "2147483647", "important");
  host.style.setProperty("isolation", "isolate", "important");
  host.style.setProperty("pointer-events", "auto", "important");
  const shadow = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = SHADOW_CSS;

  const panel = doc.createElement("div");
  panel.className = "panel";

  const label = doc.createElement("span");
  label.className = "label";
  label.textContent = "Content blacked out";

  // The label shows the matched filter term as entered, not a profile name
  // (design 3.3 [CHANGED]).
  const profile = doc.createElement("span");
  profile.className = "profile";
  profile.textContent = term || "";

  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Reveal";

  panel.appendChild(label);
  if (term) panel.appendChild(profile);
  panel.appendChild(button);
  shadow.appendChild(style);
  shadow.appendChild(panel);

  /** @param {"blacked-out"|"revealed"} state */
  function setState(state) {
    host.setAttribute(STATE_ATTR, state);
    // Record the user's decision by story identity so every masking path
    // respects it until reload or Black out again (design 3.3).
    const key = storyKey(term, container.textContent || "");
    if (state === "revealed") {
      container.classList.remove(BLACKED_CLASS);
      button.textContent = "Black out again";
      restoreMinHeight();
      markRevealed(key);
    } else {
      container.classList.add(BLACKED_CLASS);
      button.textContent = "Reveal";
      applyMinHeight();
      clearRevealed(key);
    }
  }

  button.addEventListener("click", () => {
    const revealed = host.getAttribute(STATE_ATTR) === "revealed";
    setState(revealed ? "blacked-out" : "revealed");
  });

  // A click on our UI must never reach the page or navigate an enclosing <a>:
  // cancel the default action in the capture phase (before the page or a link
  // acts), and stop the event ever bubbling out of the host (design 3.3, 8a).
  armSwallow(host);

  container.classList.add(BLACKED_CLASS);
  container.appendChild(host);

  // Now the element is in its masked layout, measure it: if it is shorter than
  // the Reveal button needs, grow it (design 8c).
  const rect = typeof container.getBoundingClientRect === "function" ? container.getBoundingClientRect() : null;
  minHeightNeeded = !rect || rect.height < MIN_MASK_HEIGHT;
  applyMinHeight();

  const record = { host, button, positionChanged, prevInlinePosition, prevInlineMinHeight, minHeightNeeded, term };
  overlays.set(container, record);
  return record;
}

/**
 * Remove the overlay and restore the container to its original state. Leaves
 * the DOM exactly as it was found (design 8a): class, injected child, and any
 * position change are undone, and now-empty attributes are dropped.
 * @param {Element} container
 */
export function cleanup(container) {
  const record = overlays.get(container);
  if (!record) return;

  container.classList.remove(BLACKED_CLASS);
  record.host.remove();

  if (record.positionChanged) {
    if (record.prevInlinePosition) {
      container.style.position = record.prevInlinePosition;
    } else {
      container.style.removeProperty("position");
    }
  }
  if (record.minHeightNeeded) {
    if (record.prevInlineMinHeight) {
      container.style.minHeight = record.prevInlineMinHeight;
    } else {
      container.style.removeProperty("min-height");
    }
  }
  if (container.getAttribute("style") === "") container.removeAttribute("style");
  if (container.getAttribute("class") === "") container.removeAttribute("class");

  overlays.delete(container);
}
