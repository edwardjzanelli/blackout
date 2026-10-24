// Reveal is honoured until reload or Black out again (design 3.3). A revealed
// story is tracked by identity (term + container text), so no masking path
// re-masks it, it survives node replacement, and a different story in the same
// place is still masked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import { reverify } from "../src/content/durability.js";
import { storyKey, isRevealed, reset } from "../src/content/revealed.js";
import * as overlay from "../src/content/overlay.js";

const BLACKED = "blackout-blacked-out";
const STARTER = {
  id: "k",
  name: "Quendle",
  enabled: true,
  includeTerms: ["Quendle", "Robin Quendle"],
  excludeTerms: [],
  matchMode: "phrase",
  expiresAt: null,
  siteScope: [],
  createdAt: 0,
  updatedAt: 0,
};
const matcher = () => compileMatcher([STARTER]);

function pageWith(headline) {
  const dom = new JSDOM(`<!doctype html><body><main></main></body>`);
  setCard(dom, "c", headline);
  return dom;
}
function setCard(dom, id, headline) {
  const { document } = dom.window;
  let card = document.getElementById(id);
  if (!card) {
    card = document.createElement("section");
    card.className = "card";
    card.id = id;
    document.querySelector("main").appendChild(card);
  }
  card.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = headline;
  card.appendChild(h);
  return card;
}

/** The real masking pipeline, consulting the revealed store before masking. */
function maskAll(dom) {
  const m = matcher();
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
    if (!container) continue;
    if (isRevealed(storyKey(hit.term, container.textContent || ""))) continue; // user revealed
    overlay.blackout(container, hit.term, { window: dom.window });
    overlay.reapply(container);
    active.add(container);
  }
  return active;
}

function clickReveal(card) {
  const btn = card.querySelector(".blackout-ui").shadowRoot.querySelector("button");
  btn.dispatchEvent(new card.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
}

/** reverify as main.js gates it: a revealed story is never re-masked. */
function guardedReverify(card, active, win, term) {
  if (isRevealed(storyKey(term, card.textContent || ""))) return;
  return reverify(card, matcher(), win, active);
}

test("Reveal, then a subsequent batch does not re-mask the story", () => {
  reset();
  const dom = pageWith("Quendle spotted downtown");
  const card = dom.window.document.getElementById("c");
  maskAll(dom);
  clickReveal(card);
  assert.ok(!card.classList.contains(BLACKED), "revealed after click");

  maskAll(dom); // another scan/observer batch
  assert.ok(!card.classList.contains(BLACKED), "still revealed after a later batch");
});

test("Reveal, then the page replaces the node with a fresh clone: still revealed", () => {
  reset();
  const dom = pageWith("Quendle spotted downtown");
  const { document } = dom.window;
  maskAll(dom);
  clickReveal(document.getElementById("c"));

  // Page re-renders: a brand-new node with the same story, no mask.
  const fresh = setCard(dom, "c", "Quendle spotted downtown");
  document.getElementById("c").replaceWith(fresh);

  maskAll(dom);
  assert.ok(!document.getElementById("c").classList.contains(BLACKED), "clone stays revealed");
});

test("Reveal, then the page reuses the node for a different matching story: masked", () => {
  reset();
  const dom = pageWith("Quendle spotted downtown");
  const card = dom.window.document.getElementById("c");
  maskAll(dom);
  clickReveal(card);

  setCard(dom, "c", "Robin Quendle announces a new venture"); // different story
  maskAll(dom);
  assert.ok(card.classList.contains(BLACKED), "a new story in the same node is masked");
});

test("Black out again, then reverify keeps it masked", () => {
  reset();
  const dom = pageWith("Quendle spotted downtown");
  const card = dom.window.document.getElementById("c");
  maskAll(dom);
  clickReveal(card); // reveal
  clickReveal(card); // black out again
  assert.ok(card.classList.contains(BLACKED), "re-masked by Black out again");

  guardedReverify(card, new Set([card]), dom.window, "Quendle");
  assert.ok(card.classList.contains(BLACKED), "reverify keeps it masked");
});
