// Page mode (design 3.6): whole-page and per-card blackout are either/or. One
// state that every masking path consults, so there are no per-path special
// cases. A page starts in per-card mode and switches to whole-page mode when
// §3.6 triggers; it stays there until reload (reset on re-evaluate).

import * as overlay from "./overlay.js";

/** @type {"per-card"|"whole-page"} */
let mode = "per-card";

/** @returns {boolean} */
export function inWholePage() {
  return mode === "whole-page";
}

/** @returns {boolean} whether per-card masks may be applied or re-applied */
export function canMaskCards() {
  return mode === "per-card";
}

/**
 * Switch to whole-page mode and drop every existing per-card mask with an exact
 * restore. After this, canMaskCards() is false, so no masking path re-applies.
 * @param {Set<Element>} activeContainers mutated: cleaned up and cleared
 */
export function enterWholePage(activeContainers) {
  mode = "whole-page";
  if (!activeContainers) return;
  for (const container of activeContainers) overlay.cleanup(container);
  activeContainers.clear();
}

/** Back to per-card mode (on re-evaluate / reload). */
export function reset() {
  mode = "per-card";
}
