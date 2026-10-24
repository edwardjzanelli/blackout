// No filter term is hard-coded (design 6.3): every starter term appears only in
// src/config/starter-profiles.json. This test derives the forbidden words from
// that config and fails if any appear under src/ (other than the config),
// scripts/, or test/*.mjs. Saved-page HTML fixtures are page content and exempt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import starters from "../src/config/starter-profiles.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join("src", "config", "starter-profiles.json");

/** Distinct words across every starter include term, read from the config. */
const forbidden = [
  ...new Set(
    starters
      .flatMap((p) => p.includeTerms || [])
      .flatMap((term) => term.split(/\s+/))
      .filter(Boolean),
  ),
];

/** Recursively collect files under dir matching the predicate. */
async function collect(dir, keep) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...(await collect(full, keep)));
    } else if (keep(full)) {
      out.push(full);
    }
  }
  return out;
}

async function scan(files) {
  const offenders = [];
  for (const file of files) {
    const rel = relative(root, file).split(sep).join("/");
    const text = await readFile(file, "utf8");
    for (const word of forbidden) {
      const re = new RegExp(word, "i");
      if (re.test(text)) offenders.push(`${rel} contains "${word}"`);
    }
  }
  return offenders;
}

test("no starter term is hard-coded outside the config", async () => {
  const srcFiles = (await collect(join(root, "src"), (f) => f.endsWith(".js"))).filter(
    (f) => relative(root, f).split(sep).join("/") !== CONFIG.split(sep).join("/"),
  );
  const scriptFiles = await collect(join(root, "scripts"), (f) => f.endsWith(".mjs"));
  const testFiles = await collect(join(root, "test"), (f) => f.endsWith(".mjs"));

  const offenders = await scan([...srcFiles, ...scriptFiles, ...testFiles]);
  assert.deepEqual(offenders, [], `starter term literals found:\n${offenders.join("\n")}`);
});
