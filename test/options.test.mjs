// Options "Block these" box (design 3.2, 3.2a, 5.2a): line parsing and the
// broad-term warning. The list reconcile (de-dupe, ids, tombstones, chunking)
// is covered by storage.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLines, broadTermWarnings } from "../src/options/options.js";

test("parseLines ignores blank lines and trims", () => {
  assert.deepEqual(parseLines("  a \n\n  b\r\n   \nc  "), ["a", "b", "c"]);
  assert.deepEqual(parseLines(""), []);
});

test("broadTermWarnings flags single words under five letters only", () => {
  assert.deepEqual(broadTermWarnings(["Zed", "Alpha", "Hi", "Longword", "New York"]), ["Zed", "Hi"]);
  assert.deepEqual(broadTermWarnings(["Robin Vole"]), []); // multi-word never flagged
});
