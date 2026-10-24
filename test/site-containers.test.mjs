// Site adapters (design 5.4): on each synthetic fixture, a matching item is
// masked at item level, its non-matching siblings are untouched, and nothing is
// masked at feed or page level. Red before the adapters existed (the sites'
// custom elements / role=article were not content units, so matches resolved to
// generic DIVs or whole sections); green after.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import { unitSelectorFor } from "../src/adapters/index.js";
import * as overlay from "../src/content/overlay.js";

const BLACKED = "blackout-blacked-out";
const ATTRS = ["title", "aria-label", "alt"];
// Invented term: no real person, and not a starter term (no-term-literals stays
// green). The fixtures mention it only in the items that should be masked.
const TERM = "Mirelle Vossen";
const profile = {
  id: "t",
  name: TERM,
  enabled: true,
  includeTerms: [TERM],
  excludeTerms: [],
  matchMode: "phrase",
  expiresAt: null,
  siteScope: [],
  createdAt: 0,
  updatedAt: 0,
};

/** Mask a fixture the way the content script would, for the given host. */
async function maskFixture(file, host) {
  const html = await readFile(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const matcher = compileMatcher([profile]);
  const extra = unitSelectorFor(host);
  const active = new Set();
  const walker = makeCandidateWalker(document, document.body, () => false);
  let node;
  while ((node = walker.nextNode())) {
    let el = null;
    let text = "";
    if (node.nodeType === 3) {
      el = node.parentElement;
      text = node.nodeValue || "";
    } else if (node.nodeType === 1) {
      el = node;
      text = ATTRS.map((a) => node.getAttribute(a)).filter(Boolean).join(" ");
    }
    if (!el || !text.trim() || !matcher.test(text) || !matcher.match(text, Date.now())) continue;
    const container = findContainer(el, dom.window, extra).container;
    if (!container || container.closest(`.${BLACKED}`)) continue; // masks never nest
    if (!active.has(container)) {
      overlay.blackout(container, TERM, { window: dom.window });
      active.add(container);
    }
  }
  return { document, active };
}

const isMasked = (el) => !!el && el.classList.contains(BLACKED);
const noneMasked = (document, selector) =>
  [...document.querySelectorAll(selector)].every((el) => !isMasked(el));

test("youtube: matching video tile and short masked at item level; siblings and feed untouched", async () => {
  const { document, active } = await maskFixture("youtube.html", "youtube.com");

  const videos = [...document.querySelectorAll("ytd-video-renderer")];
  assert.ok(isMasked(videos[0]), "matching video tile masked");
  assert.ok(videos.slice(1).every((v) => !isMasked(v)), "non-matching video tiles untouched");

  const shorts = [...document.querySelectorAll("ytm-shorts-lockup-view-model")];
  assert.ok(isMasked(shorts[0]), "matching short masked");
  assert.ok(shorts.slice(1).every((s) => !isMasked(s)), "non-matching short untouched");

  for (const sel of ["ytd-item-section-renderer", "ytd-reel-shelf-renderer", "#contents", "body", "ytd-app"]) {
    assert.ok(noneMasked(document, sel), `nothing masked at ${sel}`);
  }
  for (const el of active) {
    assert.ok(el.matches("ytd-video-renderer, ytm-shorts-lockup-view-model"), `masked ${el.tagName} is an adapter unit`);
  }
});

test("facebook: matching post masked at role=article; sibling posts and the feed untouched", async () => {
  const { document, active } = await maskFixture("facebook.html", "facebook.com");

  const posts = [...document.querySelectorAll('[role="article"]')];
  assert.equal(posts.length, 3);
  assert.ok(isMasked(posts[0]), "matching post masked");
  assert.ok(posts.slice(1).every((p) => !isMasked(p)), "non-matching posts untouched");

  for (const sel of ['[role="feed"]', '[role="main"]', "body"]) {
    assert.ok(noneMasked(document, sel), `nothing masked at ${sel}`);
  }
  for (const el of active) {
    assert.equal(el.getAttribute("role"), "article", "masked unit is a post");
  }
});

test("instagram: matching feed post and grid/reel tiles masked; other tiles and page untouched", async () => {
  const { document, active } = await maskFixture("instagram.html", "instagram.com");

  assert.ok(isMasked(document.querySelector("article")), "matching feed post masked");

  const tiles = [...document.querySelectorAll('a[role="link"][href*="/p/"], a[role="link"][href*="/reel/"]')];
  const masked = tiles.filter(isMasked).map((a) => a.getAttribute("href"));
  assert.deepEqual(masked.sort(), ["/p/aaa111/", "/reel/ccc333/"], "only the two matching tiles masked");

  for (const sel of ["main", "body"]) {
    assert.ok(noneMasked(document, sel), `nothing masked at ${sel}`);
  }
  // Every masked unit is a post or a permalink tile, never a layout wrapper.
  for (const el of active) {
    assert.ok(
      el.tagName === "ARTICLE" || el.matches('a[role="link"]'),
      `masked ${el.tagName} is an adapter unit`,
    );
  }
});
