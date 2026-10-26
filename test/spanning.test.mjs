// Phrases that span inline element boundaries (security review Part B3). A name
// wrapped in <b>/<a>/<span> ("The <b>Quendles</b>") must still be matched and
// masked, and must stay masked through re-verification. Matching is per nearest
// block, not per text node. Invented phrase; no starter-term literal (6.3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker, nearestBlock } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import { reverify, containerMatches } from "../src/content/durability.js";
import * as overlay from "../src/content/overlay.js";

const TERM = "The Quendles";
const NOW = 0;
const matcher = () =>
  compileMatcher([{ id: "p", enabled: true, includeTerms: [TERM], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [] }]);

test("nearestBlock climbs through inline tags to the bounding block", () => {
  const { document } = new JSDOM(
    `<main><article id="card"><h3 id="h">The <b id="b"><span id="s">Quendles</span></b> win</h3></article></main>`,
  ).window;
  assert.equal(nearestBlock(document.getElementById("s")).id, "h", "span -> h3 block");
  assert.equal(nearestBlock(document.getElementById("b")).id, "h", "b -> h3 block");
  assert.equal(nearestBlock(document.getElementById("h")).id, "h", "block returns itself");
  assert.equal(nearestBlock(document.getElementById("card")).id, "card", "article is a block");
});

/** Mask a document the way the content script now does: match per nearest block
 * (so a phrase split across inline markup is seen whole), resolve the container,
 * mask once. Returns the set of masked containers. */
function maskByBlock(document, win) {
  const m = matcher();
  const active = new Set();
  const seenBlocks = new WeakSet();
  const walker = makeCandidateWalker(document, document.body, () => false);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 3) continue;
    const block = nearestBlock(node.parentElement);
    if (!block || seenBlocks.has(block)) continue;
    seenBlocks.add(block);
    const text = block.textContent || "";
    if (!text.trim() || !m.test(text) || !m.match(text, NOW)) continue;
    const container = findContainer(block, win).container;
    if (!container || container.closest(".blackout-blacked-out")) continue;
    if (!active.has(container)) {
      overlay.blackout(container, TERM, { window: win });
      active.add(container);
    }
  }
  return active;
}

test("B3: a phrase split across an inline element is matched and masked", () => {
  const dom = new JSDOM(
    `<main>
       <article id="a1"><h3>Watch The <b>Quendles</b> tonight</h3></article>
       <article id="a2"><h3>Watch The <a href="/x">Quendles</a> tonight</h3></article>
       <article id="a3"><h3>A completely unrelated headline</h3></article>
     </main>`,
  );
  const { document } = dom.window;
  const active = maskByBlock(document, dom.window);

  assert.ok(document.getElementById("a1").classList.contains("blackout-blacked-out"), "<b>-split phrase masked");
  assert.ok(document.getElementById("a2").classList.contains("blackout-blacked-out"), "<a>-split phrase masked");
  assert.ok(!document.getElementById("a3").classList.contains("blackout-blacked-out"), "unrelated card untouched");
  assert.equal(active.size, 2);

  // Per-text-node matching would have missed both (neither node is the phrase).
  const m = matcher();
  assert.ok(!m.match("Watch The ", NOW) && !m.match("Quendles", NOW), "no single text node is the phrase");
});

test("B3: re-verification keeps a spanning mask instead of stripping it", () => {
  const dom = new JSDOM(`<main><article id="card"><h3>The <b>Quendles</b> are back</h3></article></main>`);
  const { document } = dom.window;
  const m = matcher();
  const container = document.getElementById("card");

  overlay.blackout(container, TERM, { window: dom.window });
  const active = new Set([container]);

  // containerMatches must see the phrase in the block's whole text.
  assert.ok(containerMatches(container, m, dom.window, NOW), "container still matches (whole-text)");
  const outcome = reverify(container, m, dom.window, active);
  assert.notEqual(outcome, "cleaned", "mask not stripped");
  assert.ok(active.has(container) && overlay.isBlackedOut(container), "still masked after reverify");
});
