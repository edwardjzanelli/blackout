// Reveal reliability (design 3.3, 8a) and no-nesting (design 3.6 addendum).
// jsdom cannot hit-test, so the stacking guarantee is asserted via the host's
// z-index and its own stacking context; click reach is asserted via event
// propagation and defaults.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as overlay from "../src/content/overlay.js";

const BLACKED = "blackout-blacked-out";

/** The Reveal/Black out again button inside a masked container's host. */
function button(container) {
  return overlay.shadowRootFor(container.querySelector(".blackout-ui")).querySelector("button");
}

test("a card that is an <a> wrapping everything never navigates on Reveal", () => {
  const dom = new JSDOM(
    `<!doctype html><body><div class="feed">` +
      `<a class="card" id="c1" href="/story"><h3>Quendle spotted</h3></a>` +
      `<a class="card" href="/two"><h3>Two</h3></a>` +
      `<a class="card" href="/three"><h3>Three</h3></a>` +
      `</div></body>`,
  );
  const { document } = dom.window;
  const card = document.getElementById("c1");
  overlay.blackout(card, "Quendle", { window: dom.window });

  let navigated = false;
  card.addEventListener("click", (e) => {
    // A real <a> would navigate here unless the default was prevented upstream.
    if (!e.defaultPrevented) navigated = true;
  });

  const btn = button(card);
  // A real user click is composed, so it crosses the shadow boundary to the host.
  const clickEvent = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  btn.dispatchEvent(clickEvent);

  assert.equal(btn.textContent, "Black out again", "Reveal toggled");
  assert.equal(navigated, false, "the wrapping <a> did not navigate");
  assert.equal(clickEvent.defaultPrevented, true, "default (navigation) was prevented");
});

test("host is its own top stacking context (beats a stretched-link ::after)", () => {
  const dom = new JSDOM(`<!doctype html><body><section class="card" id="c">` + `<h3>Quendle</h3></section></body>`);
  const { document } = dom.window;
  const card = document.getElementById("c");
  overlay.blackout(card, "Quendle", { window: dom.window });
  const host = card.querySelector(".blackout-ui");

  // jsdom can't hit-test, so assert the properties that make the host topmost
  // and atomic: maximum z-index and an isolated stacking context.
  assert.equal(host.style.getPropertyValue("z-index"), "2147483647");
  assert.equal(host.style.getPropertyValue("isolation"), "isolate");
  assert.equal(dom.window.getComputedStyle(host).zIndex, "2147483647");
});

test("a page click handler on the card does not fire when Reveal is clicked", () => {
  const dom = new JSDOM(`<!doctype html><body><section class="card" id="c">` + `<h3>Quendle</h3></section></body>`);
  const { document } = dom.window;
  const card = document.getElementById("c");
  overlay.blackout(card, "Quendle", { window: dom.window });

  let pageHandlerFired = false;
  card.addEventListener("click", () => {
    pageHandlerFired = true;
  });

  button(card).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
  assert.equal(pageHandlerFired, false, "the page's card click handler never fired");
});

test("no nesting: a match inside an already masked element does not add a mask", () => {
  const dom = new JSDOM(
    `<!doctype html><body><section class="card" id="outer">` +
      `<div id="inner"><h3>Quendle</h3></div></section></body>`,
  );
  const { document } = dom.window;
  const outer = document.getElementById("outer");
  const inner = document.getElementById("inner");

  overlay.blackout(outer, "Quendle", { window: dom.window });
  // An inner match arrives; main.js consults hasMaskedAncestor before masking.
  assert.equal(overlay.hasMaskedAncestor(inner), true);
  // So it must not be masked.
  if (!overlay.hasMaskedAncestor(inner)) overlay.blackout(inner, "Quendle", { window: dom.window });

  assert.equal(document.querySelectorAll(".blackout-ui").length, 1, "exactly one mask");
  assert.equal(inner.classList.contains(BLACKED), false, "inner not masked");
  assert.ok(outer.classList.contains(BLACKED), "outer still masked");
});

test("no nesting: masking an outer element removes any mask inside it, exactly", () => {
  const dom = new JSDOM(
    `<!doctype html><body><section class="card" id="outer">` +
      `<div id="inner"><h3>Quendle</h3></div><p>More Quendle news</p></section></body>`,
  );
  const { document } = dom.window;
  const outer = document.getElementById("outer");
  const inner = document.getElementById("inner");
  const before = outer.innerHTML;

  // Inner masked first (e.g. a narrow match), then the whole card matches.
  overlay.blackout(inner, "Quendle", { window: dom.window });
  assert.ok(inner.classList.contains(BLACKED));

  // main.js removes inner masks within the outer before masking it.
  const removed = overlay.masksWithin(outer);
  assert.deepEqual(removed, [inner], "inner mask detected within outer");
  for (const m of removed) overlay.cleanup(m);
  assert.equal(outer.innerHTML, before, "inner mask removed with exact restore");

  overlay.blackout(outer, "Quendle", { window: dom.window });
  assert.equal(document.querySelectorAll(".blackout-ui").length, 1, "exactly one mask, on the outer");
  assert.ok(outer.classList.contains(BLACKED));
  assert.equal(inner.classList.contains(BLACKED), false);
});
