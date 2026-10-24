// Overlay (design 8a): black out a container by styling it, not covering it.
// An injected stylesheet blacks the container's background and hides every
// child; one injected child, isolated in a shadow root, carries the label and
// the Reveal / Black out again control. Cleanup restores the page exactly.

const BLACKED_CLASS = "blackout-blacked-out";
const UI_CLASS = "blackout-ui";
const STYLE_ID = "blackout-stylesheet";
const STATE_ATTR = "data-blackout-state";

const DOCUMENT_CSS = `
.${BLACKED_CLASS} {
  background-color: #000 !important;
}
.${BLACKED_CLASS} > :not(.${UI_CLASS}) {
  visibility: hidden !important;
}
.${UI_CLASS} {
  z-index: 2147483646;
  visibility: visible !important;
}
.${UI_CLASS}[${STATE_ATTR}="blacked-out"] {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.${UI_CLASS}[${STATE_ATTR}="revealed"] {
  position: absolute;
  top: 4px;
  right: 4px;
}
`;

const SHADOW_CSS = `
:host { all: initial; }
.panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #fff;
  text-align: center;
}
.label { font-weight: 600; }
.profile { font-size: 12px; opacity: 0.85; }
button {
  font: inherit;
  cursor: pointer;
  padding: 4px 12px;
  border: 1px solid #fff;
  border-radius: 4px;
  background: #222;
  color: #fff;
}
button:hover { background: #333; }
button:focus-visible { outline: 2px solid #4aa3ff; outline-offset: 2px; }
:host([${STATE_ATTR}="revealed"]) .label,
:host([${STATE_ATTR}="revealed"]) .profile { display: none; }
:host([${STATE_ATTR}="revealed"]) button { background: rgba(0, 0, 0, 0.75); }
`;

/**
 * @typedef {Object} OverlayRecord
 * @property {HTMLElement} host
 * @property {HTMLButtonElement} button
 * @property {boolean} positionChanged
 * @property {string} prevInlinePosition
 */

/** @type {WeakMap<Element, OverlayRecord>} */
const overlays = new WeakMap();

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
 * @param {string} profileName name of the profile that fired, shown on the label
 * @param {{window?: Window}} [options]
 * @returns {OverlayRecord}
 */
export function blackout(container, profileName, options = {}) {
  const existing = overlays.get(container);
  if (existing) return existing;

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

  const host = doc.createElement("div");
  host.className = UI_CLASS;
  host.setAttribute(STATE_ATTR, "blacked-out");
  const shadow = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = SHADOW_CSS;

  const panel = doc.createElement("div");
  panel.className = "panel";

  const label = doc.createElement("span");
  label.className = "label";
  label.textContent = "Content blacked out";

  const profile = doc.createElement("span");
  profile.className = "profile";
  profile.textContent = profileName || "";

  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Reveal";

  panel.appendChild(label);
  if (profileName) panel.appendChild(profile);
  panel.appendChild(button);
  shadow.appendChild(style);
  shadow.appendChild(panel);

  /** @param {"blacked-out"|"revealed"} state */
  function setState(state) {
    host.setAttribute(STATE_ATTR, state);
    if (state === "revealed") {
      container.classList.remove(BLACKED_CLASS);
      button.textContent = "Black out again";
    } else {
      container.classList.add(BLACKED_CLASS);
      button.textContent = "Reveal";
    }
  }

  button.addEventListener("click", (event) => {
    // The cover sits above the card, but guard anyway so a reveal click can
    // never fall through to a link underneath (design 3.3, 8a).
    event.preventDefault();
    event.stopPropagation();
    const revealed = host.getAttribute(STATE_ATTR) === "revealed";
    setState(revealed ? "blacked-out" : "revealed");
  });

  container.classList.add(BLACKED_CLASS);
  container.appendChild(host);

  const record = { host, button, positionChanged, prevInlinePosition };
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
  if (container.getAttribute("style") === "") container.removeAttribute("style");
  if (container.getAttribute("class") === "") container.removeAttribute("class");

  overlays.delete(container);
}
