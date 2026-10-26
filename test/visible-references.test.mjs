// Whole-page cover, rule 2 (design 3.6, Ed's field-bug rulings). Only visible
// references count: text a person can see, never attributes, hidden elements or
// user-input text. Terms come only from the starter config; fixtures carry no
// real people or posts beyond the filter term itself. Red on the pre-fix HEAD:
// visibleReferences/isInUserInput did not exist, and the old count (attributes +
// hidden text) over-counted these pages.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker, blockText, INLINE_TAGS } from "../src/content/scan.js";
import { findContainer, isForbiddenBoundary } from "../src/content/container.js";
import {
  visibleReferences,
  countReferences,
  shouldCoverByRefs,
  isInUserInput,
} from "../src/content/whole-page.js";
import * as overlay from "../src/content/overlay.js";
import starterConfig from "../src/config/starter-profiles.json" with { type: "json" };

const PREFS = { pageCoverMaxRefs: 10 };
const matcher = compileMatcher(starterConfig.map((p) => ({ ...p, enabled: p.enabled !== false })));

/** True for nodes inside one of the extension's own injected elements. */
function isOwn(node) {
  let el = node && node.nodeType === 3 ? node.parentNode : node;
  while (el && el.nodeType === 1) {
    if (el.classList && el.classList.contains("blackout-ui")) return true;
    el = el.parentElement;
  }
  return false;
}

async function load(file) {
  const html = await readFile(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
  return new JSDOM(html);
}

/** Mirror the content script's masking: mask matching, visible, non-input blocks
 * at the deepest matching block; returns the set of masked containers. */
function maskPipeline(dom) {
  const { document } = dom.window;
  const win = dom.window;
  const matches = (t) => t.trim() && matcher.test(t) && matcher.match(t, Date.now());
  const childBlockMatches = (el) => {
    for (const c of el.children) {
      const tag = (c.tagName || "").toUpperCase();
      if (INLINE_TAGS.has(tag) || isOwn(c)) continue;
      if (matches(blockText(c, isOwn))) return true;
    }
    return false;
  };
  const active = new Set();
  const walker = makeCandidateWalker(document, document.body, isOwn);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 1) continue;
    const el = node;
    if (isOwn(el) || isInUserInput(el)) continue; // never mask user input
    const tag = (el.tagName || "").toUpperCase();
    if (INLINE_TAGS.has(tag) || isForbiddenBoundary(el)) continue;
    const text = blockText(el, isOwn);
    if (!matches(text) || childBlockMatches(el)) continue;
    const container = findContainer(el, win).container;
    if (!container || container.closest(".blackout-blacked-out") || active.has(container)) continue;
    overlay.blackout(container, "match", { window: win });
    active.add(container);
  }
  return active;
}

const isMasked = (el) => !!el && el.classList.contains("blackout-blacked-out");

test("(a) a suggestion dropdown: no cover, suggestions masked individually, input untouched", async () => {
  const dom = await load("suggestions.html");
  const { document } = dom.window;

  const count = countReferences(document.body, matcher, dom.window, isOwn);
  assert.equal(count, 8, "eight visible suggestions; input text and image alts do not count");
  assert.equal(shouldCoverByRefs(count, PREFS), false, "eight references do not cover the page");

  const masked = maskPipeline(dom);
  assert.equal(masked.size, 8, "each suggestion masked on its own");
  for (const li of document.querySelectorAll("#suggestions li")) assert.ok(isMasked(li), "suggestion masked");

  const input = document.getElementById("q");
  assert.ok(!isMasked(input), "the search input is not masked");
  assert.ok(!input.closest(".blackout-blacked-out"), "no ancestor of the input is masked");
  assert.equal(input.value, "kard", "the typed text is untouched and readable");
  assert.ok(isInUserInput(input), "the input is recognised as a user field");
});

test("(b) 3 visible references plus 9 hidden/attribute matches: no cover", async () => {
  const dom = await load("references-hidden.html");
  const { document } = dom.window;

  const result = visibleReferences(document.body, matcher, dom.window, isOwn);
  assert.equal(result.count, 3, "only the three visible references count");
  assert.equal(shouldCoverByRefs(result.count, PREFS), false, "three references do not cover");

  assert.equal(result.excluded.length, 9, "nine excluded matches");
  const reasons = result.excluded.map((e) => e.reason).sort();
  assert.deepEqual(
    [...new Set(reasons)].sort(),
    ["alt", "closed-details", "display-none", "opacity-0", "visibility-hidden"].sort(),
    "every exclusion reason is recorded",
  );
});

test("(c) 11 visible references: page covered", async () => {
  const dom = await load("references-visible.html");
  const { document } = dom.window;

  const count = countReferences(document.body, matcher, dom.window, isOwn);
  assert.equal(count, 11, "exactly eleven visible references (hidden extras do not count)");
  assert.equal(shouldCoverByRefs(count, PREFS), true, "more than ten visible references covers the page");
});

test("user-input fields (input, textarea, contenteditable) are recognised", () => {
  const { document } = new JSDOM(
    `<body><input id="a"><textarea id="b"></textarea><div contenteditable="true" id="c"><p id="cp">x</p></div>` +
      `<div contenteditable="false" id="d"><p id="dp">y</p></div><p id="e">z</p></body>`,
  ).window;
  assert.equal(isInUserInput(document.getElementById("a")), true);
  assert.equal(isInUserInput(document.getElementById("b")), true);
  assert.equal(isInUserInput(document.getElementById("cp")), true, "inside contenteditable");
  assert.equal(isInUserInput(document.getElementById("dp")), false, "contenteditable=false is editable off");
  assert.equal(isInUserInput(document.getElementById("e")), false, "ordinary page text");
});
