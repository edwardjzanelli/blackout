// Whole-page cover (design 3.6, §8a mechanism at page scale). One fixed,
// full-viewport host in a shadow root, topmost z-order, with page scrolling
// locked while covered. Reveal shows the page (per-card masks stay) and leaves
// a corner "Black out again" button; it re-covers on click. Keyboard operable,
// visible focus, no em dashes.

import { armSwallow } from "./overlay.js";

const COVER_ID = "blackout-page-cover";
const STATE_ATTR = "data-blackout-cover";
const Z_TOP = 2147483647;

const COVER_CSS = `
:host { all: initial; }
:host([${STATE_ATTR}="revealed"]) { pointer-events: none; }
.cover {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  box-sizing: border-box;
  background: #000;
  color: #fff;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: center;
}
.label { font-weight: 600; max-width: 42ch; margin: 0; }
.profile { opacity: 0.85; font-size: 14px; margin: 0; }
button {
  font: inherit;
  cursor: pointer;
  padding: 6px 14px;
  border: 1px solid #fff;
  border-radius: 6px;
  background: #222;
  color: #fff;
  pointer-events: auto;
}
button:hover { background: #333; }
button:focus-visible { outline: 2px solid #4aa3ff; outline-offset: 2px; }
.again { position: fixed; top: 10px; right: 10px; }
:host([${STATE_ATTR}="covered"]) .again { display: none; }
:host([${STATE_ATTR}="revealed"]) .cover { display: none; }
`;

/**
 * @typedef {Object} CoverState
 * @property {HTMLElement} host
 * @property {HTMLElement} root documentElement, whose overflow we lock
 * @property {string} prevOverflow inline overflow before we locked it
 * @property {HTMLButtonElement} revealBtn
 * @property {HTMLButtonElement} againBtn
 */

/** @type {CoverState|null} single cover per page */
let state = null;

/**
 * Our closed shadow roots, keyed by host (the cover host). Closed so a page
 * script cannot read the cover's term label; this map lets our own code and
 * tests reach it, while a page that imports this module gets a separate,
 * empty map in its own realm.
 * @type {WeakMap<Element, ShadowRoot>}
 */
const shadowRoots = new WeakMap();

/**
 * The closed shadow root we attached to the cover host, or null.
 * @param {Element} host
 * @returns {ShadowRoot|null}
 */
export function shadowRootFor(host) {
  return shadowRoots.get(host) || null;
}

/** @returns {boolean} */
export function isPageCovered() {
  return state !== null;
}

/**
 * Cover the whole page. No-op if already covered (it stays until reload or the
 * user reveals, design 3.6: never flips back mid-scroll).
 * @param {Document} doc
 * @param {string} term the matched include term as entered; the only text
 *   rendered on the cover (design 3.3, 3.6) — no profile name
 * @param {{window?: Window}} [options]
 */
export function coverPage(doc, term, options = {}) {
  if (state) return;

  const host = doc.createElement("div");
  host.id = COVER_ID;
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.setProperty("z-index", String(Z_TOP), "important");
  host.style.setProperty("isolation", "isolate", "important");
  const shadow = host.attachShadow({ mode: "closed" });
  shadowRoots.set(host, shadow);

  const style = doc.createElement("style");
  style.textContent = COVER_CSS;

  const cover = doc.createElement("div");
  cover.className = "cover";
  const label = doc.createElement("p");
  label.className = "label";
  label.textContent = `Lots of ${term} references on this page, so we blocked out the entire page.`;
  // The second line is the matched term exactly as entered (design 3.3).
  const profile = doc.createElement("p");
  profile.className = "profile";
  profile.textContent = term || "";
  const revealBtn = doc.createElement("button");
  revealBtn.type = "button";
  revealBtn.className = "reveal";
  revealBtn.textContent = "Reveal";

  const againBtn = doc.createElement("button");
  againBtn.type = "button";
  againBtn.className = "again";
  againBtn.textContent = "Black out again";

  cover.appendChild(label);
  if (term) cover.appendChild(profile);
  cover.appendChild(revealBtn);
  shadow.appendChild(style);
  shadow.appendChild(cover);
  shadow.appendChild(againBtn);

  const root = doc.documentElement;
  state = { host, root, prevOverflow: root.style.overflow, revealBtn, againBtn };

  /** @param {boolean} covered */
  function setCovered(covered) {
    host.setAttribute(STATE_ATTR, covered ? "covered" : "revealed");
    if (covered) {
      root.style.overflow = "hidden"; // lock scrolling
      revealBtn.focus();
    } else {
      // Restore the previous overflow exactly.
      if (state.prevOverflow) root.style.overflow = state.prevOverflow;
      else root.style.removeProperty("overflow");
      againBtn.focus();
    }
  }

  revealBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCovered(false);
  });
  againBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCovered(true);
  });

  // Clicks on the cover and the corner button never reach the page or navigate
  // (design 3.6, same guarantee as a card mask).
  armSwallow(host);

  (doc.body || root).appendChild(host);
  setCovered(true);
}

/**
 * Remove the cover entirely and restore scrolling (for pause / re-evaluate).
 */
export function uncoverPage() {
  if (!state) return;
  if (state.prevOverflow) state.root.style.overflow = state.prevOverflow;
  else state.root.style.removeProperty("overflow");
  state.host.remove();
  state = null;
}
