// The display text for a match is the include term exactly as entered, on every
// surface (card label and whole-page cover). No rendering code reads a profile
// name, so a stale invented name in stored data is never shown (design 3.3,
// 3.6, 6.3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { compileMatcher, displayTerm } from "../src/content/matcher.js";
import { findContainer } from "../src/content/container.js";
import * as overlay from "../src/content/overlay.js";
import * as pageCover from "../src/content/page-cover.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A stored profile whose name is an invented plural (as an old seed left it),
// while the include term as entered is the singular. Rendering must show the
// term, never the name.
const ENTERED = "Quendle";
const INVENTED_NAME = "Quendles";
const STORED_PROFILE = {
  id: "p1",
  name: INVENTED_NAME,
  enabled: true,
  includeTerms: [ENTERED],
  excludeTerms: [],
  matchMode: "phrase",
  expiresAt: null,
  siteScope: [],
  createdAt: 0,
  updatedAt: 0,
};

test("the card label renders the include term as entered, not the profile name", () => {
  const dom = new JSDOM(`<!doctype html><body><section class="card" id="c"><h3>${ENTERED} spotted</h3></section></body>`);
  const { document } = dom.window;
  const matcher = compileMatcher([STORED_PROFILE]);
  const card = document.getElementById("c");
  const hit = matcher.match(card.querySelector("h3").textContent, Date.now());

  overlay.blackout(card, displayTerm(hit), { window: dom.window });
  const shown = overlay.shadowRootFor(card.querySelector(".blackout-ui")).querySelector(".profile").textContent;
  assert.equal(shown, ENTERED);
  assert.notEqual(shown, INVENTED_NAME);
});

test("the whole-page cover renders the include term as entered, not the profile name", () => {
  const dom = new JSDOM(`<!doctype html><body></body>`);
  const { document } = dom.window;
  const matcher = compileMatcher([STORED_PROFILE]);
  const hit = matcher.match(`${ENTERED} is everywhere`, Date.now());

  pageCover.uncoverPage();
  pageCover.coverPage(document, displayTerm(hit), { window: dom.window });
  const host = document.getElementById("blackout-page-cover");
  const label = pageCover.shadowRootFor(host).querySelector(".label").textContent;
  const second = pageCover.shadowRootFor(host).querySelector(".profile").textContent;

  assert.match(label, new RegExp(`Lots of ${ENTERED} references`));
  assert.equal(second, ENTERED, "second line is the term");
  assert.doesNotMatch(label + " " + second, new RegExp(INVENTED_NAME));
  pageCover.uncoverPage();
});

/** Recursively collect .js files under dir. */
async function collectJs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectJs(full)));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("no rendering code under src/ references a profile name", async () => {
  const offenders = [];
  for (const file of await collectJs(join(root, "src"))) {
    const text = await readFile(file, "utf8");
    if (/profileName/.test(text)) offenders.push(`${file} references profileName`);
    if (/profile\.name/.test(text)) offenders.push(`${file} references profile.name`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
