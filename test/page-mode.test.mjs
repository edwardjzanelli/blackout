// Page mode (design 3.6): whole-page and per-card blackout are either/or. Once
// a page is in whole-page mode, no card masks are applied or re-applied, every
// existing card mask is removed (exact restore) when the cover goes up, and
// Reveal / Black out again never bring card masks back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import { reverify } from "../src/content/durability.js";
import * as overlay from "../src/content/overlay.js";
import * as pageCover from "../src/content/page-cover.js";
import * as pageMode from "../src/content/page-mode.js";

const STARTER = {
  id: "k",
  name: "Quendle",
  enabled: true,
  includeTerms: ["Quendle", "Robin Quendle", "Casey Quendle", "Dana Quendle"],
  excludeTerms: [],
  matchMode: "phrase",
  expiresAt: null,
  siteScope: [],
  createdAt: 0,
  updatedAt: 0,
};
const matcher = () => compileMatcher([STARTER]);
const BLACKED = ".blackout-blacked-out";
const UI = ".blackout-ui";

function feedDom(total, matching) {
  const dom = new JSDOM(`<!doctype html><body><main><div class="feed"></div></main></body>`);
  const { document } = dom.window;
  const feed = document.querySelector(".feed");
  for (let i = 0; i < total; i++) {
    const card = document.createElement("section");
    card.className = "card";
    card.id = `s${i}`;
    const h = document.createElement("h3");
    h.textContent = i < matching ? `Quendle story number ${i}` : `Local sports recap number ${i}`;
    card.appendChild(h);
    feed.appendChild(card);
  }
  return dom;
}

/** Mask matching cards only when the page is in per-card mode (consults the
 * single page-mode decision, as every masking path in main.js does). */
function maskAll(dom) {
  const active = new Set();
  if (!pageMode.canMaskCards()) return active;
  const m = matcher();
  const walker = makeCandidateWalker(dom.window.document, dom.window.document.body, () => false);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 3) continue;
    const text = node.nodeValue || "";
    if (!text.trim() || !m.test(text) || !m.match(text, Date.now())) continue;
    const { container } = findContainer(node.parentElement, dom.window);
    if (!container || active.has(container)) continue;
    overlay.blackout(container, "Quendle", { window: dom.window });
    active.add(container);
  }
  return active;
}

/** The reverify path as main.js gates it: never re-applies in whole-page mode. */
function guardedReverify(container, active, win) {
  if (pageMode.inWholePage()) return;
  if (active.has(container)) reverify(container, matcher(), win, active);
}

const reveal = (doc) => doc.getElementById("blackout-page-cover").shadowRoot.querySelector(".reveal").click();
const blackoutAgain = (doc) => doc.getElementById("blackout-page-cover").shadowRoot.querySelector(".again").click();

test("covered at start: Reveal leaves zero card masks", () => {
  pageMode.reset();
  pageCover.uncoverPage();
  const dom = feedDom(5, 5);
  const { document } = dom.window;

  // Rule 1 covered the page at document_start, before any card was masked.
  pageMode.enterWholePage(new Set());
  pageCover.coverPage(document, "Quendle", { window: dom.window });

  assert.equal(maskAll(dom).size, 0, "no card masks applied in whole-page mode");
  reveal(document);
  assert.equal(document.querySelector(BLACKED), null, "no card masks after Reveal");
  assert.equal(document.querySelector(UI), null);
});

test("rule 2 mid-page removes every existing card mask, exactly", () => {
  pageMode.reset();
  pageCover.uncoverPage();
  const dom = feedDom(10, 6);
  const { document } = dom.window;
  const before = document.body.innerHTML;

  const active = maskAll(dom);
  assert.equal(active.size, 6, "six cards masked in per-card mode");
  assert.ok(document.querySelector(BLACKED), "masks present before cover");

  pageMode.enterWholePage(active); // rule 2 fires: cover goes up
  assert.equal(document.body.innerHTML, before, "all card masks removed, exact restore");
  assert.equal(active.size, 0);
});

test("reverify does not re-mask cards in whole-page mode", () => {
  pageMode.reset();
  pageCover.uncoverPage();
  const dom = feedDom(10, 6);
  const { document } = dom.window;

  const active = maskAll(dom);
  const wereMasked = [...active];
  pageMode.enterWholePage(active);

  for (const container of wereMasked) guardedReverify(container, active, dom.window);
  assert.equal(pageMode.canMaskCards(), false);
  assert.equal(document.querySelector(BLACKED), null, "reverify did not re-apply any card mask");
  assert.equal(document.querySelector(UI), null);
  assert.equal(maskAll(dom).size, 0, "a fresh scan masks nothing either");
});

test("Black out again restores the cover with no card masks", () => {
  pageMode.reset();
  pageCover.uncoverPage();
  const dom = feedDom(8, 6);
  const { document } = dom.window;

  const active = maskAll(dom);
  pageMode.enterWholePage(active);
  pageCover.coverPage(document, "Quendle", { window: dom.window });
  const host = document.getElementById("blackout-page-cover");

  reveal(document);
  assert.equal(maskAll(dom).size, 0, "scan after Reveal masks nothing in whole-page mode");

  blackoutAgain(document);
  assert.equal(host.getAttribute("data-blackout-cover"), "covered");
  assert.equal(document.querySelector(BLACKED), null, "still no card masks under the cover");
});
