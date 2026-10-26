// Whole-page blackout (design 3.6, FR-17). Rule 1: the page title or a URL
// search word matches a filter. The cover reuses the §8a mechanism, locks
// scrolling while covered, and labels with the include term as entered
// (most-matched when several match). Rule 2 (visible references) is covered by
// references.test.mjs and visible-references.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { ruleOneTerm, mostMatchedTerm } from "../src/content/whole-page.js";
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
const matcher = () => compileMatcher([STARTER]);

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
