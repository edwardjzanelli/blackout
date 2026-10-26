// Diagnostic for the design review: load the DEBUG build against a real page
// with a given filter list and print the whole-page cover explanation the
// content script logs. Build first: `npm run build -- --debug`.
//
//   node scripts/nypost-check.mjs --terms=<a,b,...> [url]
//
// Terms come from the invocation, never from a repo file (design 6.3, enforced
// by no-term-literals.test.mjs). Default url is https://nypost.com/ca/.

import { chromium } from "playwright";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const termsArg = (argv.find((a) => a.startsWith("--terms=")) || "").slice("--terms=".length);
const TERMS = termsArg.split(",").map((t) => t.trim()).filter(Boolean);
const TARGET = argv.find((a) => !a.startsWith("--")) || "https://nypost.com/ca/";
const SETTLE_MS = 25_000;
if (!TERMS.length) {
  console.error("usage: node scripts/nypost-check.mjs --terms=<a,b,...> [url]");
  process.exit(2);
}

function makeKeyAndId() {
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  const der = publicKey;
  const hash = createHash("sha256").update(der).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (hash[i] >> 4)) + String.fromCharCode(97 + (hash[i] & 0xf));
  return { key: der.toString("base64"), id };
}

const extDir = await mkdtemp(join(tmpdir(), "blackout-ext-"));
await cp(join(root, "dist", "chrome"), extDir, { recursive: true });
const { key, id } = makeKeyAndId();
const manifestPath = join(extDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.key = key;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const userDataDir = await mkdtemp(join(tmpdir(), "blackout-nypost-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

const logLines = [];
let nav = { title: "", text: "", href: TARGET };
let covered = false;
let maskedUnits = 0;

try {
  // Set the given filter list through the options page (replaces the seeded
  // starters), so the content script matches on exactly those terms.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options/options.html`, { waitUntil: "load" });
  await options.waitForSelector("#block-list");
  await options.fill("#block-list", TERMS.join("\n"));
  await options.click("#block-form button[type=submit]");
  await options.waitForSelector("#saved-note:not([hidden])", { timeout: 4000 }).catch(() => {});

  const page = await context.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[blackout]")) logLines.push(t.replace(/^.*\[blackout\]\s?/, ""));
  });

  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: SETTLE_MS });
  try {
    await page.waitForLoadState("networkidle", { timeout: SETTLE_MS });
  } catch {
    /* streaming pages never idle; settle by timeout */
  }
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight)).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(1500);

  nav = await page.evaluate(() => ({
    title: document.title,
    href: location.href,
    text: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 400),
  }));
  covered = (await page.locator("#blackout-page-cover").count()) > 0;
  maskedUnits = await page.locator(".blackout-blacked-out").count();
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
  await rm(extDir, { recursive: true, force: true });
}

const botWall = /are you a robot|verify you are human|enable javascript|consent|unusual traffic|access denied|px-captcha|cf-browser-verification/i.test(
  `${nav.title} ${nav.text}`,
);

console.log("=== blackout nypost-check ===");
console.log(`url: ${TARGET}`);
console.log(`terms: ${JSON.stringify(TERMS)}`);
console.log(`landed on: ${nav.href}`);
console.log(`title: ${nav.title}`);
console.log(`body text (first 400): ${nav.text}`);
console.log(`covered: ${covered}   masked units: ${maskedUnits}`);
console.log(`[blackout] log lines: ${logLines.length}`);
console.log("");
if (botWall) {
  console.log("BOT WALL / CONSENT PAGE: nypost did not serve real content to headless Chromium. Stop here.");
  process.exit(2);
}
console.log("=== [blackout] log ===");
for (const line of logLines) console.log(line);
process.exit(0);
