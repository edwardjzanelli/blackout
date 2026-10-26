// Phrases split by a rendered break (security review Part B3, Ed's ruling: every
// phrase the user enters is matched). Block-text extraction treats <br>, <wbr>
// and block-level descendant boundaries as whitespace, so "The<br>Quendles" and
// "<div>The</div><div>Quendles</div>" read as "The Quendles", while an inline
// split inside a word ("Quen<b>dles</b>") stays one word. One extraction
// function (scan.blockText) is shared by scanning, the reference count and
// durability. Invented phrase; no starter-term literal (6.3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { blockText, INLINE_TAGS } from "../src/content/scan.js";
import { findContainer, isForbiddenBoundary } from "../src/content/container.js";
import { reverify, containerMatches } from "../src/content/durability.js";
import { countReferences } from "../src/content/whole-page.js";
import * as overlay from "../src/content/overlay.js";

const NOW = 0;
const phrase = () =>
  compileMatcher([{ id: "p", enabled: true, includeTerms: ["The Quendles"], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [] }]);
const word = () =>
  compileMatcher([{ id: "q", enabled: true, includeTerms: ["Quendles"], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [] }]);

/** The first element child of a fresh body built from html. */
function root(html) {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  return document.getElementById("r") || document.body.firstElementChild;
}

test("B3: a rendered break (br, wbr, adjacent blocks) is whitespace in block text", () => {
  const m = phrase();
  for (const html of [
    "<h3>The<br>Quendles</h3>",
    "<h3>The<br/>Quendles</h3>",
    "<h3>The<wbr>Quendles</h3>",
    "<div id=r><div>The</div><div>Quendles</div></div>",
    "<div id=r><p>The</p><p>Quendles</p></div>",
    "<ul id=r><li>The</li><li>Quendles</li></ul>",
  ]) {
    const text = blockText(root(html), () => false);
    assert.ok(m.match(text, NOW), `phrase matched in ${JSON.stringify(html)} -> ${JSON.stringify(text)}`);
  }
});

test("B3: an inline split inside a word stays one word, not two", () => {
  const w = word();
  const text = blockText(root("<h3>Quen<b>dles</b></h3>"), () => false);
  assert.equal(text, "Quendles", "no space inserted at an inline boundary");
  assert.ok(w.match(text, NOW), "'Quendles' matches");
  // Prove it is not read as "Quen dles": a term of the two split halves as a
  // phrase must NOT match the joined word.
  const split = compileMatcher([{ id: "s", enabled: true, includeTerms: ["Quen dles"], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [] }]);
  assert.ok(!split.match(text, NOW), "the word is not split into two");
});

test("B3: re-verification keeps a mask whose phrase is split by a <br>", () => {
  const dom = new JSDOM(`<main><article id="card"><h3>The<br>Quendles</h3></article></main>`);
  const { document } = dom.window;
  const m = phrase();
  const container = document.getElementById("card");

  overlay.blackout(container, "The Quendles", { window: dom.window });
  const active = new Set([container]);

  assert.ok(containerMatches(container, m, dom.window, NOW), "container still matches via block text");
  assert.notEqual(reverify(container, m, dom.window, active), "cleaned", "mask not stripped");
  assert.ok(active.has(container) && overlay.isBlackedOut(container), "still masked");
});

test("B3: a reference split by a break still counts (shared extraction)", () => {
  const dom = new JSDOM(`<main><article id="card"><h3>The<br>Quendles</h3></article></main>`);
  const refs = countReferences(dom.window.document.body, phrase(), dom.window, () => false);
  assert.equal(refs, 1, "the broken phrase counts as one reference");
});

/** Mirror the content script's block-element scanning: mask at the deepest
 * matching block, resolving its container; never mask a wrapper larger than the
 * matched phrase. */
function maskByBlocks(html) {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  const win = document.defaultView;
  const m = phrase();
  const matches = (t) => t.trim() && m.test(t) && !!m.match(t, NOW);
  const childBlockMatches = (el) => {
    for (const c of el.children) {
      if (INLINE_TAGS.has((c.tagName || "").toUpperCase())) continue;
      if (matches(blockText(c, () => false))) return true;
    }
    return false;
  };
  const active = new Set();
  for (const el of [document.body, ...document.body.querySelectorAll("*")]) {
    if (INLINE_TAGS.has((el.tagName || "").toUpperCase()) || isForbiddenBoundary(el)) continue;
    const text = blockText(el, () => false);
    if (!matches(text) || childBlockMatches(el)) continue;
    const container = findContainer(el, win).container;
    if (container && !container.closest(".blackout-blacked-out") && !active.has(container)) {
      overlay.blackout(container, "The Quendles", { window: win });
      active.add(container);
    }
  }
  return document;
}

const masked = (doc, id) => doc.getElementById(id).classList.contains("blackout-blacked-out");

test("B3: the mask lands on the deepest matching block, not a larger wrapper", () => {
  // Bare nested blocks, no card: the inner block is masked, the wrapper is not.
  let doc = maskByBlocks(`<div id="outer"><h3 id="inner">The Quendles</h3></div>`);
  assert.ok(masked(doc, "inner"), "inner block masked");
  assert.ok(!masked(doc, "outer"), "wrapper not over-masked");

  // Phrase spanning adjacent block children: their common block is masked.
  doc = maskByBlocks(`<div id="outer"><div id="a">The</div><div id="b">Quendles</div></div>`);
  assert.ok(masked(doc, "outer"), "the block spanning both parts is masked");
  assert.ok(!masked(doc, "a") && !masked(doc, "b"), "neither half alone is masked");

  // With a content unit (card), the mask resolves up to the card.
  doc = maskByBlocks(`<article id="card"><h3 id="h">The<br>Quendles</h3></article>`);
  assert.ok(masked(doc, "card"), "card unit masked");
});
