// Capture the four Chrome Web Store screenshots in one run, all at exactly
// 1280x800, written outside the repo to c:\work\blackout\demo-shots\. Same setup
// as before: the built extension loaded and the demo site served. This script
// starts and stops the demo server itself and leaves no process running.
//
//   npm run build        # the extension must be built first
//   npm run store-shots
//
// Produces: front-after.png (individual blackouts, no cover), reveal.png (lead
// revealed with "Black out again", the other blackouts still in place),
// full-after.png (whole-page cover), settings.png (the options page with the
// starter term in the "Block these" box, Save, and the credit line).

import { chromium } from "playwright";
import { createDemoServer, DEFAULT_PORT, TERM } from "./demo.mjs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "c:/work/blackout/demo-shots";
const VP = { width: 1280, height: 800 };
const base = `http://localhost:${DEFAULT_PORT}`;

/** A manifest key and the extension id Chrome derives from it, so the options
 * page has a stable chrome-extension:// URL. */
function makeKeyAndId() {
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  const hash = createHash("sha256").update(publicKey).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (hash[i] >> 4)) + String.fromCharCode(97 + (hash[i] & 0xf));
  return { key: publicKey.toString("base64"), id };
}

await mkdir(OUT, { recursive: true });

// Keyed temp copy of the built extension (for the options-page URL).
const extDir = await mkdtemp(join(tmpdir(), "diskard-ext-"));
await cp(join(root, "dist", "chrome"), extDir, { recursive: true });
const { key, id } = makeKeyAndId();
const manifestPath = join(extDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.key = key;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const server = createDemoServer();
await new Promise((resolve) => server.listen(DEFAULT_PORT, resolve));

const userDataDir = await mkdtemp(join(tmpdir(), "diskard-udd-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  viewport: VP,
  deviceScaleFactor: 1, // 1 CSS px = 1 device px, so screenshots are exactly 1280x800
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

const shots = [];
try {
  // Front page: wait for the individual blackouts to appear.
  const front = await ctx.newPage();
  await front.setViewportSize(VP);
  await front.goto(`${base}/`, { waitUntil: "networkidle" });
  await front.waitForSelector(".blackout-blacked-out");
  await front.waitForTimeout(1500);
  await front.screenshot({ path: join(OUT, "front-after.png") });
  shots.push("front-after.png");

  // Reveal: click Reveal on the lead story. Our shadow roots are closed, so a
  // selector cannot reach the button; a real mouse click hits it through the
  // composed tree. The Reveal button sits in the centre of the (large) lead mask,
  // so click near the host centre, sweeping a little, until the host's
  // data-blackout-state (in the light DOM) flips to "revealed".
  const leadHost = front.locator("article.lead .blackout-ui").first();
  const box = await leadHost.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let revealed = false;
  for (const dy of [24, 0, 40, -20, 60, 12, 80]) {
    await front.mouse.click(cx, cy + dy);
    await front.waitForTimeout(250);
    revealed = await leadHost.evaluate((el) => el.getAttribute("data-blackout-state") === "revealed");
    if (revealed) break;
  }
  if (!revealed) throw new Error("could not reveal the lead story");
  await front.waitForTimeout(1200);
  await front.screenshot({ path: join(OUT, "reveal.png") });
  shots.push("reveal.png");
  await front.close();

  // Full page: the whole-page cover.
  const full = await ctx.newPage();
  await full.setViewportSize(VP);
  await full.goto(`${base}/full.html`, { waitUntil: "networkidle" });
  await full.waitForSelector("#blackout-page-cover");
  await full.waitForTimeout(1200);
  await full.screenshot({ path: join(OUT, "full-after.png") });
  shots.push("full-after.png");
  await full.close();

  // Settings: the options page. The starter config seeds four terms, so the box
  // would show four lines; Ed wants exactly one, the term as he typed it
  // (lowercase). Wait for the seeded lines to load, then type the single line
  // (derived from the config term, lowercased, so no term literal enters the
  // repo). Centered exactly as Chrome renders it; not restyled.
  const opts = await ctx.newPage();
  await opts.setViewportSize(VP);
  await opts.goto(`chrome-extension://${id}/options/options.html`, { waitUntil: "load" });
  await opts.waitForFunction(
    () => {
      const box = document.getElementById("block-list");
      return box && box.value.trim().length > 0;
    },
    { timeout: 5000 },
  );
  await opts.fill("#block-list", TERM.toLowerCase());
  await opts.waitForTimeout(400);
  await opts.screenshot({ path: join(OUT, "settings.png") });
  shots.push("settings.png");
  await opts.close();
} finally {
  await ctx.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
  await rm(extDir, { recursive: true, force: true });
}

// Confirm every image is exactly 1280x800 (PNG IHDR: width@16, height@20).
console.log(`store screenshots (filter term "${TERM}") written to ${OUT}:`);
for (const name of shots) {
  const buf = await readFile(join(OUT, name));
  console.log(`  ${name}: ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
}
