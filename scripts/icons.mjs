// Rasterizes the single Diskard icon source (src/icons/diskard.svg) to PNGs at
// 16, 32, 48 and 128 px with transparent backgrounds, into src/icons/. Same
// design at every size (no simplified small version). Uses the repo's existing
// Playwright/Chromium, no new dependency. The PNGs are committed, so the normal
// build does not rasterize; regenerate after changing the artwork:
//
//   npm run icons

import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "src", "icons");
const SIZES = [16, 32, 48, 128];

const svg = await readFile(join(iconsDir, "diskard.svg"), "utf8");
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const n of SIZES) {
    // One page per size at exactly n x n device pixels, transparent background.
    const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">` +
        `<style>html,body{margin:0;padding:0;background:transparent}` +
        `svg{display:block;width:${n}px;height:${n}px}</style>` +
        svg,
      { waitUntil: "load" },
    );
    const buf = await page.screenshot({ omitBackground: true });
    await writeFile(join(iconsDir, `icon${n}.png`), buf);
    await page.close();
    console.log(`wrote src/icons/icon${n}.png (${buf.length} bytes)`);
  }
} finally {
  await browser.close();
}
