// Container resolver tests (design 5.1, 8b) against jsdom fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { findContainer } from "../src/content/container.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} file
 * @returns {Promise<JSDOM>}
 */
async function loadFixture(file) {
  const html = await readFile(join(here, "fixtures", file), "utf8");
  return new JSDOM(html);
}

test("walks up to the matching card, not the feed", async () => {
  const dom = await loadFixture("card-grid.html");
  const { document } = dom.window;
  const heading = document.querySelector("#card-2 h3");
  const decision = findContainer(heading.firstChild, dom.window);
  assert.equal(decision.container, document.getElementById("card-2"));
  assert.equal(decision.reason, "chosen");
});

test("a match loose in the body masks the smallest element, not the body", async () => {
  // Ruling (design 8b): a matched word is never left visible. The <p> is the
  // smallest safe element containing it; <body> itself is never masked.
  const dom = await loadFixture("body-match.html");
  const { document } = dom.window;
  const lead = document.getElementById("lead");
  const decision = findContainer(lead.firstChild, dom.window);
  assert.equal(decision.container, lead);
  assert.equal(decision.reason, "smallest");
});

test("an input-bearing card is refused but the match's own heading is masked", async () => {
  const dom = new JSDOM(
    `<!doctype html><body><article id="c"><form><input name="q"></form><h3>Topic heading</h3></article></body>`,
  );
  const { document } = dom.window;
  const heading = document.querySelector("#c h3");
  const decision = findContainer(heading.firstChild, dom.window);
  // The article holds a form input, so it is not masked; the <h3> is.
  assert.equal(decision.container, heading);
  assert.equal(decision.reason, "smallest");
  assert.notEqual(decision.container, document.getElementById("c"));
});

test("refuses when the only container is page structure (text direct in body)", async () => {
  const dom = new JSDOM(`<!doctype html><body>Loose topic text</body>`);
  const { document } = dom.window;
  const decision = findContainer(document.body.firstChild, dom.window);
  assert.equal(decision.container, null);
  assert.equal(decision.reason, "forbidden-tag");
});
