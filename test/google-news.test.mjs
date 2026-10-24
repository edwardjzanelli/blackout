// Google News regression (design 5.1, 5.4, 8b). Two defects from the live run:
//  - masking a card changed its class, so its still-unmasked same-signature
//    siblings fell below the repeated-item threshold and were left visible;
//  - sidebar entries with no card (heading link, follow button, standalone
//    chip) were refused and left visible.
// A matched word must never be left visible, and masking must stay at the
// smallest sensible element (card, or the link/chip/heading itself), never the
// feed wrapper, <aside> or <main>.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import * as overlay from "../src/content/overlay.js";

const here = dirname(fileURLToPath(import.meta.url));
const BLACKED = "blackout-blacked-out";
const ATTRS = ["title", "aria-label", "alt"];

const STARTER = {
  id: "k",
  name: "Kardashians",
  enabled: true,
  includeTerms: ["Kardashian", "Kris Jenner", "Kylie Jenner", "Kendall Jenner"],
  excludeTerms: [],
  matchMode: "phrase",
  expiresAt: null,
  siteScope: [],
  createdAt: 0,
  updatedAt: 0,
};

async function loadGnews() {
  const html = await readFile(join(here, "fixtures", "google-news-search.html"), "utf8");
  return new JSDOM(html);
}

/** Run the real content pipeline over the page; return the masked containers. */
function runPipeline(dom) {
  const { document } = dom.window;
  const matcher = compileMatcher([STARTER]);
  const active = new Set();
  const walker = makeCandidateWalker(document, document.body, () => false);
  let node;
  while ((node = walker.nextNode())) {
    let element = null;
    let text = "";
    if (node.nodeType === 3) {
      element = node.parentElement;
      text = node.nodeValue || "";
    } else if (node.nodeType === 1) {
      element = node;
      text = ATTRS.map((a) => node.getAttribute(a)).filter(Boolean).join(" ");
    }
    if (!element || !text.trim() || !matcher.test(text)) continue;
    if (!matcher.match(text, Date.now())) continue;
    const { container } = findContainer(element, dom.window);
    if (!container || active.has(container)) continue;
    overlay.blackout(container, "Kardashians", { window: dom.window });
    active.add(container);
  }
  return active;
}

const maskedEl = (c) => c.classList.contains(BLACKED) && !!c.querySelector(".blackout-ui");

test("findContainer resolves a feed headline to its card, not <main>", async () => {
  const dom = await loadGnews();
  const card = dom.window.document.getElementById("card-1");
  const decision = findContainer(card.querySelector("a.JtKRv").firstChild, dom.window);
  assert.equal(decision.reason, "chosen");
  assert.equal(decision.container, card);
});

test("all five matching feed cards are masked at card level (even after siblings mask)", async () => {
  const dom = await loadGnews();
  const { document } = dom.window;
  runPipeline(dom);
  for (const id of ["card-1", "card-2", "card-3", "card-4", "card-5"]) {
    assert.ok(maskedEl(document.getElementById(id)), `${id} masked at card level`);
  }
});

test("non-matching feed cards stay untouched", async () => {
  const dom = await loadGnews();
  const { document } = dom.window;
  runPipeline(dom);
  for (const id of ["nm-1", "nm-2", "nm-3"]) {
    assert.ok(!document.getElementById(id).classList.contains(BLACKED), `${id} untouched`);
  }
});

test("a sidebar topic heading with no card is masked at its own element", async () => {
  const dom = await loadGnews();
  const { document } = dom.window;
  runPipeline(dom);
  assert.ok(maskedEl(document.getElementById("topic-title")), "topic heading link masked");
});

test("a 'Follow this topic' button is masked via its aria-label", async () => {
  const dom = await loadGnews();
  const { document } = dom.window;
  runPipeline(dom);
  assert.ok(maskedEl(document.getElementById("follow")), "follow button masked");
});

test("a standalone topic chip is masked; a non-matching chip is not", async () => {
  const dom = await loadGnews();
  const { document } = dom.window;
  runPipeline(dom);
  assert.ok(maskedEl(document.getElementById("chip")), "matching chip masked");
  assert.ok(!document.getElementById("chip-other").classList.contains(BLACKED), "other chip untouched");
});

test("nothing at <main>, <aside> or a feed wrapper is masked", async () => {
  const dom = await loadGnews();
  const { document } = dom.window;
  runPipeline(dom);
  assert.ok(!document.querySelector("main").classList.contains(BLACKED));
  assert.ok(!document.querySelector("aside").classList.contains(BLACKED));
  for (const wrap of document.querySelectorAll("c-wiz.D9SJMe")) {
    assert.ok(!wrap.classList.contains(BLACKED), "feed wrapper not masked");
  }
});

test("each matching card is masked exactly once despite text + title matches", async () => {
  const dom = await loadGnews();
  const { document } = dom.window;
  const active = runPipeline(dom);
  // five feed cards + three sidebar elements (heading, follow, chip) = 8.
  assert.equal(active.size, 8, "eight containers masked");
  assert.equal(document.getElementById("card-1").querySelectorAll(".blackout-ui").length, 1);
});
