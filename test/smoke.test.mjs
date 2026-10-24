// Smoke tests for the M0 scaffold: the build emits a valid MV3 manifest, and no
// source file makes a network call (design 9: the extension never talks to a
// network). Run with `npm test`, which builds first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chromeDir = join(root, "dist", "chrome");

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

// The M1 live failure was "Failed to fetch dynamically imported module": a
// module reachable from content/main.js could not be loaded. These tests walk
// the real static import graph in the built package and guard the three ways
// that fetch can break: an unresolved specifier, a module missing from
// web_accessible_resources, and (the actual M1 cause) a dynamic resource URL
// that blocks relative imports across the graph.

test("every module reachable from content/main.js resolves to a built file", async () => {
  const { missing } = await importGraph(chromeDir, "content/main.js");
  assert.deepEqual(missing, [], `unresolved imports: ${missing.join(", ")}`);
});

test("every module in the graph is covered by web_accessible_resources", async () => {
  const manifest = JSON.parse(await readFile(join(chromeDir, "manifest.json"), "utf8"));
  const entries = manifest.web_accessible_resources || [];
  const { modules } = await importGraph(chromeDir, "content/main.js");
  for (const mod of modules) {
    const covered = entries.some((e) => (e.resources || []).some((r) => resourceCovers(r, mod)));
    assert.ok(covered, `${mod} is not listed in web_accessible_resources`);
  }
});

test("graph modules are not served under a dynamic URL (breaks relative imports)", async () => {
  const manifest = JSON.parse(await readFile(join(chromeDir, "manifest.json"), "utf8"));
  const entries = manifest.web_accessible_resources || [];
  const { modules } = await importGraph(chromeDir, "content/main.js");
  for (const mod of modules) {
    for (const e of entries) {
      if ((e.resources || []).some((r) => resourceCovers(r, mod))) {
        assert.notEqual(
          e.use_dynamic_url,
          true,
          `${mod} is served with use_dynamic_url:true, which blocks the import graph`,
        );
      }
    }
  }
});

/** Remove comments so JSDoc `import("...")` type refs are not read as imports. */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Relative module specifiers from static import/export and dynamic import().
 * @param {string} code
 * @returns {string[]}
 */
function relativeSpecifiers(code) {
  const src = stripComments(code);
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1].startsWith("./") || m[1].startsWith("../")) specs.add(m[1]);
    }
  }
  return [...specs];
}

/**
 * Walk the static import graph from an entry module (paths relative to baseDir,
 * forward-slashed). Returns the set of reachable modules and any that could not
 * be read.
 * @param {string} baseDir
 * @param {string} entryRel
 * @returns {Promise<{modules: string[], missing: string[]}>}
 */
async function importGraph(baseDir, entryRel) {
  const seen = new Set();
  const missing = [];
  const queue = [entryRel];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    let code;
    try {
      code = await readFile(join(baseDir, rel), "utf8");
    } catch {
      missing.push(rel);
      continue;
    }
    for (const spec of relativeSpecifiers(code)) {
      queue.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
    }
  }
  return { modules: [...seen].sort(), missing };
}

/**
 * Whether a web_accessible_resources pattern covers a module path. Supports an
 * exact match or a simple `*` glob (not crossing path separators).
 * @param {string} resource
 * @param {string} modulePath
 * @returns {boolean}
 */
function resourceCovers(resource, modulePath) {
  if (resource === modulePath) return true;
  if (!resource.includes("*")) return false;
  const re = new RegExp(
    "^" +
      resource
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*") +
      "$",
  );
  return re.test(modulePath);
}

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
