// Whole-page blackout (design 3.6, FR-17). Rule 1: the page title or a URL
// search word matches a filter. Rule 2: more than half of the detected stories
// match, with at least a minimum count. The cover reuses the §8a mechanism,
// locks scrolling while covered, and labels with the include term as entered
// (most-matched when several match).

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import * as overlay from "../src/content/overlay.js";
import {
  ruleOneTerm,
  storyCounts,
  shouldCoverByStories,
  mostMatchedTerm,
} from "../src/content/whole-page.js";
import * as pageCover from "../src/content/page-cover.js";

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
const PREFS = { pageCoverRatio: 0.5, pageCoverMinMatches: 6 };
const matcher = () => compileMatcher([STARTER]);

/** A feed of `total` same-signature cards, the first `matching` of which match. */
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

/** Mask everything that matches; return the set of masked containers. */
function maskAll(dom) {
  const m = matcher();
  const active = new Set();
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

const coverLabel = (doc) => pageCover.shadowRootFor(doc.getElementById("blackout-page-cover")).querySelector(".label").textContent;

test("matcher reports the include term as entered, not the matched surface", () => {
  assert.equal(matcher().match("the Quendles arrived", Date.now()).term, "Quendle");
});

test("rule 1: a URL search word (?q=quendles) matches", () => {
  const hit = ruleOneTerm(matcher(), { title: "", search: "?q=quendles" }, Date.now());
  assert.ok(hit, "covered by URL");
  assert.equal(hit.term, "Quendle");
});

test("rule 1: a matching page title matches", () => {
  const hit = ruleOneTerm(matcher(), { title: "Quendle - Google News", search: "" }, Date.now());
  assert.ok(hit);
  assert.equal(hit.term, "Quendle");
});

test("rule 1: no title/URL match returns null", () => {
  const hit = ruleOneTerm(matcher(), { title: "Weather forecast", search: "?q=weather" }, Date.now());
  assert.equal(hit, null);
});

test("rule 2: 6 matching of 10 stories covers", () => {
  const counts = storyCounts(maskAll(feedDom(10, 6)));
  assert.deepEqual(counts, { total: 10, matched: 6 });
  assert.equal(shouldCoverByStories(counts, PREFS), true);
});

test("rule 2: 5 matching of 6 does not cover (below the minimum)", () => {
  const counts = storyCounts(maskAll(feedDom(6, 5)));
  assert.deepEqual(counts, { total: 6, matched: 5 });
  assert.equal(shouldCoverByStories(counts, PREFS), false);
});

test("rule 2: 6 matching of 13 does not cover (not more than half)", () => {
  const counts = storyCounts(maskAll(feedDom(13, 6)));
  assert.deepEqual(counts, { total: 13, matched: 6 });
  assert.equal(shouldCoverByStories(counts, PREFS), false);
});

test("rule 2: a page with no matches is never covered", () => {
  const counts = storyCounts(maskAll(feedDom(10, 0)));
  assert.deepEqual(counts, { total: 0, matched: 0 });
  assert.equal(shouldCoverByStories(counts, PREFS), false);
});

test("label uses the include term as entered and the most-matched term", () => {
  const termInfo = new Map([
    ["Quendle", { count: 3 }],
    ["Robin Quendle", { count: 5 }],
  ]);
  assert.equal(mostMatchedTerm(termInfo), "Robin Quendle");

  const dom = new JSDOM(`<!doctype html><body></body>`);
  pageCover.uncoverPage();
  pageCover.coverPage(dom.window.document, "Robin Quendle", { window: dom.window });
  assert.equal(
    coverLabel(dom.window.document),
    "Lots of Robin Quendle references on this page, so we blocked out the entire page.",
  );
});

test("cover locks scrolling and restores the previous overflow exactly on Reveal", () => {
  const dom = new JSDOM(`<!doctype html><body></body>`);
  const { document } = dom.window;
  document.documentElement.style.overflow = "scroll";
  pageCover.uncoverPage();

  pageCover.coverPage(document, "Quendle", { window: dom.window });
  assert.equal(document.documentElement.style.overflow, "hidden", "scroll locked while covered");

  const host = document.getElementById("blackout-page-cover");
  pageCover.shadowRootFor(host).querySelector(".reveal").click();
  assert.equal(document.documentElement.style.overflow, "scroll", "previous overflow restored exactly");
});

test("Reveal then Black out again toggles the cover and the scroll lock", () => {
  const dom = new JSDOM(`<!doctype html><body></body>`);
  const { document } = dom.window;
  pageCover.uncoverPage();
  pageCover.coverPage(document, "Quendle", { window: dom.window });
  const host = document.getElementById("blackout-page-cover");

  pageCover.shadowRootFor(host).querySelector(".reveal").click(); // reveal
  assert.equal(host.getAttribute("data-blackout-cover"), "revealed");

  pageCover.shadowRootFor(host).querySelector(".again").click(); // black out again
  assert.equal(host.getAttribute("data-blackout-cover"), "covered");
  assert.equal(document.documentElement.style.overflow, "hidden");
});
