// Mask durability (design 5.3a): the feed re-renders, so a mask must verify
// itself. Each test sets up a masked card, simulates a page re-render, then
// calls reverify and asserts the mask ends up correct.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { findContainer } from "../src/content/container.js";
import { reverify, containerMatches } from "../src/content/durability.js";
import * as overlay from "../src/content/overlay.js";

const BLACKED = "blackout-blacked-out";
const STARTER = {
  id: "k",
  name: "Kardashians",
  enabled: true,
  includeTerms: ["Kardashian", "Kris Jenner"],
  excludeTerms: [],
  matchMode: "phrase",
  expiresAt: null,
  siteScope: [],
  createdAt: 0,
  updatedAt: 0,
};

/** A feed of three same-signature cards; the first holds `headline`. */
function feedDom(headline) {
  const dom = new JSDOM(
    `<!doctype html><body><main><div class="feed">` +
      `<section class="card" id="c1"></section>` +
      `<section class="card" id="c2"></section>` +
      `<section class="card" id="c3"></section>` +
      `</div></main></body>`,
  );
  const { document } = dom.window;
  setHeadline(document.getElementById("c1"), headline);
  setHeadline(document.getElementById("c2"), "Sports roundup from last night");
  setHeadline(document.getElementById("c3"), "Weather stays sunny all week");
  return dom;
}

/** Set a card's headline with DOM APIs only (never innerHTML of page text). */
function setHeadline(card, text) {
  card.replaceChildren();
  const h = card.ownerDocument.createElement("h3");
  h.textContent = text;
  card.appendChild(h);
}

/** Mask c1 the way the content script would, returning {container, active}. */
function maskFirst(dom) {
  const c1 = dom.window.document.getElementById("c1");
  const { container } = findContainer(c1.querySelector("h3").firstChild, dom.window);
  overlay.blackout(container, "Kardashians", { window: dom.window });
  const active = new Set([container]);
  return { container, active };
}

const matcher = () => compileMatcher([STARTER]);

test("B(a) page strips our class -> reverify re-applies it", () => {
  const dom = feedDom("Kim Kardashian spotted downtown");
  const { container, active } = maskFirst(dom);
  container.classList.remove(BLACKED); // page re-render strips our class
  assert.ok(!overlay.isIntact(container), "mask broken after strip");

  reverify(container, matcher(), dom.window, active);
  assert.ok(overlay.isIntact(container), "mask re-applied");
  assert.ok(container.classList.contains(BLACKED));
});

test("B(b) page removes our injected child -> reverify re-attaches it", () => {
  const dom = feedDom("Kim Kardashian spotted downtown");
  const { container, active } = maskFirst(dom);
  container.querySelector(".blackout-ui").remove(); // page removes our node
  assert.ok(!overlay.isIntact(container), "mask broken after child removal");

  reverify(container, matcher(), dom.window, active);
  assert.ok(overlay.isIntact(container), "child re-attached");
  assert.ok(container.querySelector(".blackout-ui"));
});

test("B(c) page replaces a masked card with a fresh clone -> clone masked, old dropped", () => {
  const dom = feedDom("Kim Kardashian spotted downtown");
  const { document } = dom.window;
  const { container, active } = maskFirst(dom);
  assert.ok(overlay.isIntact(container));

  // Page swaps in a brand-new node with the same (matching) content, no mask.
  const fresh = document.createElement("section");
  fresh.className = "card";
  fresh.id = "c1";
  setHeadline(fresh, "Kim Kardashian spotted downtown");
  container.replaceWith(fresh);

  assert.equal(reverify(container, matcher(), dom.window, active), "removed");
  assert.ok(!active.has(container), "old node dropped from active");

  const { container: freshContainer } = findContainer(fresh.querySelector("h3").firstChild, dom.window);
  overlay.blackout(freshContainer, "Kardashians", { window: dom.window });
  assert.ok(overlay.isIntact(fresh), "fresh clone masked");
});

test("B(d) page reuses a masked node for a non-matching story -> ends unmasked", () => {
  const dom = feedDom("Kim Kardashian spotted downtown");
  const { container, active } = maskFirst(dom);
  assert.ok(overlay.isIntact(container));

  setHeadline(container, "Local transit budget approved"); // recycled, no match
  reverify(container, matcher(), dom.window, active);

  assert.ok(!container.classList.contains(BLACKED), "class removed");
  assert.equal(container.querySelector(".blackout-ui"), null, "overlay removed");
  assert.ok(!active.has(container), "dropped from active");
});

test("containerMatches ignores our own label text", () => {
  const dom = feedDom("Kim Kardashian spotted downtown");
  const { container } = maskFirst(dom);
  // The profile label "Kardashians" lives in our shadow host; it must not count.
  setHeadline(container, "A quiet day in local news");
  assert.equal(containerMatches(container, matcher(), dom.window, Date.now()), false);
});
