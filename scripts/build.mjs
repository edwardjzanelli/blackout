// Build script: emit one unpacked extension package per browser from one source
// tree (design 6a). Only chrome is implemented for v0.1; firefox and safari are
// stubbed as manifest transforms so they can be added without restructuring.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const distDir = join(root, "dist");

/** The module dynamic-imported by the content-script loader (design 6a). */
const CONTENT_ENTRY = "content/main.js";

/** `npm run build -- --debug` turns on content-script decision logging. */
const DEBUG_BUILD = process.argv.includes("--debug");

/**
 * Remove debug-only source regions, delimited by `/* @debug-only:start *\/` ...
 * `/* @debug-only:end *\/`, from a shipped module. This is how the page-writable
 * `blackout:no-page-rule` localStorage escape hatch is physically removed from a
 * normal (non-debug) build, not merely guarded at runtime: a store build has no
 * code path that reads it. Debug builds keep the regions.
 * @param {string} code
 * @returns {string}
 */
export function stripDebugBlocks(code) {
  return code.replace(/[ \t]*\/\* @debug-only:start \*\/[\s\S]*?\/\* @debug-only:end \*\/\n?/g, "");
}

/** Strip comments so JSDoc `import("...")` type refs are not read as imports. */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Relative module specifiers used by a module: static import/export ... from,
 * bare side-effect imports, and dynamic import().
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
 * Walk the static import graph from an entry module and return every reachable
 * module as a forward-slashed path relative to srcDir. Every web-accessible
 * module must be listed, so this is the source of truth for
 * web_accessible_resources: a newly imported module is picked up automatically.
 * Throws if a specifier cannot be resolved to a file.
 * @param {string} entryRel
 * @returns {Promise<string[]>}
 */
async function importGraph(entryRel) {
  const seen = new Set();
  const queue = [entryRel];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    let code;
    try {
      code = await readFile(join(srcDir, rel), "utf8");
    } catch {
      throw new Error(`import graph: ${rel} is imported but does not exist in src/`);
    }
    for (const spec of relativeSpecifiers(code)) {
      queue.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
    }
  }
  return [...seen].sort();
}

/**
 * A browser target is a transform from the base manifest to its per-browser
 * form. Chrome is the base (identity). Firefox and Safari are intentionally left
 * out of the active set for v0.1; the shape below shows where they plug in.
 *
 * @typedef {(manifest: object) => object} ManifestTransform
 * @type {Record<string, ManifestTransform>}
 */
const TRANSFORMS = {
  chrome: (manifest) => manifest,
  // firefox: (manifest) => ({
  //   ...manifest,
  //   // background.service_worker -> background.scripts, add
  //   // browser_specific_settings.gecko.id (design 6a). Moot if no background.
  // }),
  // safari: (manifest) => manifest, // packaged via xcrun, see design 6a.
};

/** Targets built by default. */
const ACTIVE_TARGETS = ["chrome"];

/**
 * Build one target into dist/<name>/.
 * @param {string} name
 * @param {ManifestTransform} transform
 */
async function buildTarget(name, transform) {
  const out = join(distDir, name);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // Copy the shared source tree. Icons live in src/icons (the committed PNGs and
  // their SVG source), so they are copied with it into dist/<name>/icons.
  await cp(srcDir, out, { recursive: true });

  // The base manifest is a source file, not a shipped artifact: drop it and
  // write the transformed manifest.json in its place.
  await rm(join(out, "manifest.base.json"), { force: true });
  const base = JSON.parse(
    await readFile(join(srcDir, "manifest.base.json"), "utf8"),
  );
  const manifest = transform(structuredClone(base));

  // Generate web_accessible_resources from the actual import graph so it can
  // never drift out of sync with the code. use_dynamic_url must be false:
  // true serves each module under a distinct, per-fetch URL, which blocks the
  // relative static imports between these modules (the M1 load failure).
  const graph = await importGraph(CONTENT_ENTRY);
  manifest.web_accessible_resources = [
    { resources: graph, matches: ["<all_urls>"], use_dynamic_url: false },
  ];

  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // In the built copies only (src stays DEBUG = false): a debug build flips the
  // logging flag on; a normal build strips every debug-only region so the shipped
  // code physically cannot read the page-writable no-page-rule flag (design 9).
  for (const rel of graph.filter((r) => r.endsWith(".js"))) {
    const modulePath = join(out, rel);
    const code = await readFile(modulePath, "utf8");
    const next = DEBUG_BUILD
      ? code.replace("const DEBUG = false;", "const DEBUG = true;")
      : stripDebugBlocks(code);
    if (next !== code) await writeFile(modulePath, next);
  }

  console.log(`built dist/${name}${DEBUG_BUILD ? " (debug)" : ""}`);
}

/** Build all active targets. Guarded so importing this module (e.g. in tests)
 * does not trigger a build. */
export async function buildAll() {
  for (const name of ACTIVE_TARGETS) {
    const transform = TRANSFORMS[name];
    if (!transform) {
      throw new Error(`no manifest transform for target "${name}"`);
    }
    await buildTarget(name, transform);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await buildAll();
}
