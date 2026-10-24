// Build script: emit one unpacked extension package per browser from one source
// tree (design 6a). Only chrome is implemented for v0.1; firefox and safari are
// stubbed as manifest transforms so they can be added without restructuring.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const iconsDir = join(root, "icons");
const distDir = join(root, "dist");

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

  // Copy the shared source tree and the icons.
  await cp(srcDir, out, { recursive: true });
  await cp(iconsDir, join(out, "icons"), { recursive: true });

  // The base manifest is a source file, not a shipped artifact: drop it and
  // write the transformed manifest.json in its place.
  await rm(join(out, "manifest.base.json"), { force: true });
  const base = JSON.parse(
    await readFile(join(srcDir, "manifest.base.json"), "utf8"),
  );
  const manifest = transform(structuredClone(base));
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(`built dist/${name}`);
}

for (const name of ACTIVE_TARGETS) {
  const transform = TRANSFORMS[name];
  if (!transform) {
    throw new Error(`no manifest transform for target "${name}"`);
  }
  await buildTarget(name, transform);
}
