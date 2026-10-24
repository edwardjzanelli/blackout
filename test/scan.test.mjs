// Scanning tests (design 5.1): the candidate walker must read visible card
// text and skip non-visible text in script/style/etc. elements.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { makeCandidateWalker } from "../src/content/scan.js";

const here = dirname(fileURLToPath(import.meta.url));

async function loadFixture(file) {
  const html = await readFile(join(here, "fixtures", file), "utf8");
  return new JSDOM(html);
}

/** Collect the text of every text node the walker visits under root. */
function visitedText(doc, root) {
  const walker = makeCandidateWalker(doc, root, () => false);
  const texts = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) texts.push(node.nodeValue);
  }
  return texts.join(" | ");
}

test("scans visible card text but skips script and style text", async () => {
  const dom = await loadFixture("script-noise.html");
  const { document } = dom.window;
  const text = visitedText(document, document.body);

  assert.match(text, /Kim Kardashian spotted downtown/, "visible card text is scanned");
  assert.doesNotMatch(text, /ItemList|Kardashian search results/, "JSON-LD script text is skipped");
  assert.doesNotMatch(text, /pageData|searchTerm/, "inline script text is skipped");
  assert.doesNotMatch(text, /::after|content:/, "style text is skipped");
});
