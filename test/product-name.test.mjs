// Product name (Ed's ruling): the user-facing name is Diskard; the internal name
// stays Blackout. No user-visible string may say "Blackout". This checks the
// manifest's user-visible fields, the popup and options pages (visible text and
// tab title, not internal ids/classes), and the injected mask and page-cover UI.
// Internal identifiers, storage keys, CSS classes and the "[blackout]" log prefix
// are deliberately not checked: they must keep the internal name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import manifest from "../src/manifest.base.json" with { type: "json" };
import * as overlay from "../src/content/overlay.js";
import * as pageCover from "../src/content/page-cover.js";

const BRAND = /blackout/i;

test("manifest user-visible fields do not say 'Blackout'", () => {
  assert.doesNotMatch(manifest.name, BRAND, "store listing name");
  assert.doesNotMatch(manifest.action.default_title, BRAND, "toolbar button title");
  assert.doesNotMatch(manifest.description, BRAND, "store listing description");
});

/** Visible text of one of our HTML pages: the tab title plus rendered text,
 * never attributes (so internal ids like #blackout-popup are not checked). */
async function visibleText(relPath) {
  const html = await readFile(new URL(relPath, import.meta.url), "utf8");
  const { document } = new JSDOM(html).window;
  return `${document.title}\n${document.body.textContent || ""}`;
}

test("popup page shows no 'Blackout' in its visible text or tab title", async () => {
  assert.doesNotMatch(await visibleText("../src/popup/popup.html"), BRAND);
});

test("options page shows no 'Blackout' in its visible text or tab title", async () => {
  assert.doesNotMatch(await visibleText("../src/options/options.html"), BRAND);
});

test("injected mask and page-cover UI show no 'Blackout' in their visible text", () => {
  const { window } = new JSDOM("<!doctype html><body><article><p>a story</p></article></body>");
  const { document } = window;

  const container = document.querySelector("article");
  overlay.blackout(container, "Some Term", { window });
  pageCover.coverPage(document, "Some Term", { window });

  // The visible label/button text lives in each component's open shadow root.
  // Skip the <style> child: its CSS legitimately references internal names (e.g.
  // the data-blackout-state attribute selector), which are not user-visible text.
  let injected = "";
  for (const host of document.querySelectorAll(".blackout-ui, #blackout-page-cover")) {
    if (!host.shadowRoot) continue;
    for (const node of host.shadowRoot.childNodes) {
      if (node.nodeType === 1 && (node.tagName === "STYLE" || node.tagName === "SCRIPT")) continue;
      injected += "\n" + (node.textContent || "");
    }
  }
  assert.ok(injected.trim().length > 0, "found injected UI text to check");
  assert.doesNotMatch(injected, BRAND);
});
