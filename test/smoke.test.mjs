// Smoke tests for the M0 scaffold: the build emits a valid MV3 manifest, and no
// source file makes a network call (design 9: the extension never talks to a
// network). Run with `npm test`, which builds first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("build produces dist/chrome/manifest.json that parses as MV3", async () => {
  const raw = await readFile(join(root, "dist", "chrome", "manifest.json"), "utf8");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifest_version, 3, "manifest_version must be 3");
});

test("no source file makes a network request", async () => {
  const forbidden = [/fetch\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/];
  const files = await collectFiles(join(root, "src"));
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(text),
        `${file} must not reference ${pattern.source}`,
      );
    }
  }
});

/**
 * Recursively list every file under dir.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}
