// Pause behaviour (design 3.1, FR-09): pausing removes every mask with an exact
// restore; resuming re-masks. (isPaused is unit-tested in storage.test.mjs; this
// exercises the teardown/restore the content script performs on pause.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import * as overlay from "../src/content/overlay.js";

const BLACKED = "blackout-blacked-out";
const TERM = "Zeta";
const profile = () => ({
  id: "p",
  name: TERM,
  enabled: true,
  includeTerms: [TERM],
  excludeTerms: [],
  matchMode: "phrase",
  expiresAt: null,
  siteScope: [],
  createdAt: 0,
  updatedAt: 0,
});

function feedDom(n) {
  const dom = new JSDOM(`<!doctype html><body><main><div class="feed"></div></main></body>`);
  const feed = dom.window.document.querySelector(".feed");
  for (let i = 0; i < n; i++) {
    const card = dom.window.document.createElement("section");
    card.className = "card";
    const h = dom.window.document.createElement("h3");
    h.textContent = `${TERM} story number ${i}`;
    card.appendChild(h);
    feed.appendChild(card);
  }
  return dom;
}

function maskAll(dom) {
  const m = compileMatcher([profile()]);
  const active = new Set();
  const walker = makeCandidateWalker(dom.window.document, dom.window.document.body, () => false);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 3) continue;
    const text = node.nodeValue || "";
    if (!text.trim() || !m.test(text)) continue;
    const hit = m.match(text, Date.now());
    if (!hit) continue;
    const { container } = findContainer(node.parentElement, dom.window);
    if (!container || active.has(container)) continue;
    overlay.blackout(container, hit.term, { window: dom.window });
    active.add(container);
  }
  return active;
}

test("pause removes every mask with an exact restore, resume re-masks", () => {
  const dom = feedDom(3);
  const { document } = dom.window;
  const before = document.body.innerHTML;

  const active = maskAll(dom);
  assert.equal(active.size, 3, "three masked");
  assert.ok(document.querySelector(`.${BLACKED}`), "masks present");

  // Pause: the content script tears every mask down (overlay.cleanup is exact).
  for (const container of active) overlay.cleanup(container);
  active.clear();
  assert.equal(document.body.innerHTML, before, "every mask removed, exact restore");

  // Resume: scanning masks them again.
  const again = maskAll(dom);
  assert.equal(again.size, 3, "re-masked on resume");
});
