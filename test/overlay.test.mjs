// Overlay tests (design 8a): only the matching card is masked, Reveal toggles
// to re-blackout, a reveal click does not reach the link underneath, and
// cleanup restores the DOM exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import * as overlay from "../src/content/overlay.js";

const here = dirname(fileURLToPath(import.meta.url));

async function loadGrid() {
  const html = await readFile(join(here, "fixtures", "card-grid.html"), "utf8");
  const dom = new JSDOM(html);
  return dom;
}

const BLACKED_CLASS = "blackout-blacked-out";

/** @param {Element} card */
function uiHost(card) {
  return card.querySelector(".blackout-ui");
}

test("masks only the matching card; siblings are untouched", async () => {
  const dom = await loadGrid();
  const { document } = dom.window;
  const card = document.getElementById("card-2");

  overlay.blackout(card, "Quendle", { window: dom.window });

  assert.ok(card.classList.contains(BLACKED_CLASS));
  const host = uiHost(card);
  assert.ok(host, "injected UI host present");
  const shadowButton = overlay.shadowRootFor(host).querySelector("button");
  assert.equal(overlay.shadowRootFor(host).querySelector(".label").textContent, "Content blacked out");
  assert.equal(overlay.shadowRootFor(host).querySelector(".profile").textContent, "Quendle");
  assert.equal(shadowButton.textContent, "Reveal");

  for (const id of ["card-1", "card-3"]) {
    const sibling = document.getElementById(id);
    assert.ok(!sibling.classList.contains(BLACKED_CLASS), `${id} not blacked out`);
    assert.equal(uiHost(sibling), null, `${id} has no injected UI`);
  }
});

test("Reveal then re-blackout toggles the card and the button label", async () => {
  const dom = await loadGrid();
  const { document } = dom.window;
  const card = document.getElementById("card-2");
  overlay.blackout(card, "Quendle", { window: dom.window });
  const button = overlay.shadowRootFor(uiHost(card)).querySelector("button");

  button.click(); // reveal
  assert.ok(!card.classList.contains(BLACKED_CLASS), "revealed: class removed");
  assert.equal(button.textContent, "Black out again");

  button.click(); // re-blackout
  assert.ok(card.classList.contains(BLACKED_CLASS), "re-blacked: class restored");
  assert.equal(button.textContent, "Reveal");
});

test("a reveal click does not activate the link underneath", async () => {
  const dom = await loadGrid();
  const { document } = dom.window;
  const card = document.getElementById("card-2");
  overlay.blackout(card, "Quendle", { window: dom.window });

  let linkActivated = false;
  document.getElementById("card-2-link").addEventListener("click", () => {
    linkActivated = true;
  });

  overlay.shadowRootFor(uiHost(card)).querySelector("button").click();
  assert.equal(linkActivated, false);
});

test("cleanup restores the original DOM exactly", async () => {
  const dom = await loadGrid();
  const { document } = dom.window;
  const card = document.getElementById("card-2");
  const before = document.body.innerHTML;

  overlay.blackout(card, "Quendle", { window: dom.window });
  overlay.cleanup(card);

  assert.ok(!card.classList.contains(BLACKED_CLASS));
  assert.equal(uiHost(card), null);
  assert.equal(document.body.innerHTML, before);
});
