// Settings dashboard (design 3.2, 3.2a, 3.4, 5.2a): one multiline box, one term
// per line. Save reconciles the whole filter set through storage.js (each line
// a single-term filter); no autosave, so half-typed terms never apply. The
// broad-term warning is inline and never blocks saving. No term literals here;
// keyboard operable with visible focus; no browser dialogs.

import { loadState, saveTermList } from "../shared/storage.js";

/** Split a textarea into trimmed, non-empty lines. */
export function parseLines(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Lines that are a single word under five letters (design 5.2a). Warns only. */
export function broadTermWarnings(terms) {
  return terms.filter((term) => /^\S+$/.test(term) && term.length < 5);
}

/* ------------------------------------------------------------------ */
/* DOM wiring: only runs inside the options page.                     */
/* ------------------------------------------------------------------ */

function init() {
  const box = document.getElementById("block-list");
  const warning = document.getElementById("broad-warning");
  const saved = document.getElementById("saved-note");

  function updateWarning() {
    const broad = broadTermWarnings(parseLines(box.value));
    if (broad.length) {
      warning.textContent = `Heads up: short, common terms can over-match (${broad.join(", ")}). They still save.`;
      warning.hidden = false;
    } else {
      warning.textContent = "";
      warning.hidden = true;
    }
  }

  async function load() {
    const { profiles } = await loadState();
    // One line per filter, the term exactly as stored.
    box.value = profiles.map((p) => (p.includeTerms && p.includeTerms[0]) || "").filter(Boolean).join("\n");
    updateWarning();
  }

  box.addEventListener("input", () => {
    updateWarning();
    saved.hidden = true;
  });

  document.getElementById("block-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveTermList(parseLines(box.value));
    await load(); // reflect the de-duplicated, reconciled list
    saved.hidden = false;
  });

  load();
}

if (typeof document !== "undefined" && document.getElementById("blackout-options")) {
  init();
}
