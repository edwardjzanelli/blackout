// Whole-page rule 2 (design 3.6): the page is covered when more than
// pageCoverMaxRefs (default 10) visible references to filter terms appear. A
// reference is one element whose own visible text matches, counted once;
// attribute matches (alt/aria-label/title) and our own injected nodes never
// count. Visibility exclusions and user input are covered in
// visible-references.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { countReferences, shouldCoverByRefs } from "../src/content/whole-page.js";

const TERM = "Mirelle Vossen";
const matcher = compileMatcher([
  { id: "t", name: TERM, enabled: true, includeTerms: [TERM], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [], createdAt: 0, updatedAt: 0 },
]);
const prefs = { pageCoverMaxRefs: 10 };

/** True for nodes inside one of the extension's own injected elements. */
function isOwn(node) {
  let el = node && node.nodeType === 3 ? node.parentNode : node;
  while (el && el.nodeType === 1) {
    if (el.classList && el.classList.contains("blackout-ui")) return true;
    el = el.parentElement;
  }
  return false;
}

/** N standalone matching references, in distinct parents so no card group forms. */
function pageWithRefs(n) {
  const items = Array.from({ length: n }, (_, i) => `<section id="s${i}"><p>${TERM} item ${i}</p></section>`).join("");
  return new JSDOM(`<!doctype html><body>${items}</body>`).window;
}

test("11 references cover the page; 10 do not", () => {
  const win11 = pageWithRefs(11);
  assert.equal(countReferences(win11.document.body, matcher, win11, isOwn), 11);
  assert.ok(shouldCoverByRefs(11, prefs), "11 references cover");

  const win10 = pageWithRefs(10);
  assert.equal(countReferences(win10.document.body, matcher, win10, isOwn), 10);
  assert.equal(shouldCoverByRefs(10, prefs), false, "10 references do not cover");
});

test("an element counts once by its visible text; its matching attributes do not add to the count", () => {
  const win = new JSDOM(
    `<!doctype html><body><div title="${TERM}" aria-label="${TERM}">${TERM} everywhere</div></body>`,
  ).window;
  assert.equal(countReferences(win.document.body, matcher, win, isOwn), 1, "counted once, by its text");
});

test("an element matching only in attributes (no visible text) does not count", () => {
  const win = new JSDOM(
    `<!doctype html><body><img alt="${TERM}" /><div title="${TERM}"></div></body>`,
  ).window;
  assert.equal(countReferences(win.document.body, matcher, win, isOwn), 0, "attribute-only matches are not references");
});

test("our own injected labels are not counted as references", () => {
  const win = new JSDOM(
    `<!doctype html><body><div class="blackout-ui"><span>${TERM}</span></div><p>${TERM} in the page</p></body>`,
  ).window;
  assert.equal(countReferences(win.document.body, matcher, win, isOwn), 1, "only the page text counts");
});
