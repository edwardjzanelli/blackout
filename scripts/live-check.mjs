// Live check: load the built extension in a real Chromium, open a Google News
// search for a term the starter profile blocks, and report what the content
// script decided. Requires a debug build: `npm run build -- --debug` first.
//
// Exit 0 only when at least one container is masked and no matched card was
// left visible because a card-sized element was refused.

import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(root, "dist", "chrome");
const TARGET = process.argv[2] || "https://news.google.com/search?q=Kardashian";
const SETTLE_MS = 20_000;

const logLines = [];
const userDataDir = await mkdtemp(join(tmpdir(), "blackout-live-"));

const context = await chromium.launchPersistentContext(userDataDir, {
  // channel "chromium" uses the full Chrome-for-Testing build in the new
  // headless mode, which (unlike the default headless shell) loads extensions.
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

let masked = 0;
let nav = { href: TARGET, title: "", text: "" };
try {
  const page = context.pages()[0] || (await context.newPage());
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[blackout]")) logLines.push(text.replace(/^.*\[blackout\]\s?/, ""));
  });

  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: SETTLE_MS });
  try {
    await page.waitForLoadState("networkidle", { timeout: SETTLE_MS });
  } catch {
    // Google News streams; settling by timeout is fine.
  }

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1000);
  }

  nav = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : "").slice(0, 300),
  }));
  masked = await page.locator(".blackout-ui").count();
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}

const matchCount = logLines.filter((l) => l.startsWith("match profile=")).length;
const refusals = {};
for (const line of logLines) {
  const m = line.match(/^container refused reason=(\S+)/);
  if (m) refusals[m[1]] = (refusals[m[1]] || 0) + 1;
}

// Distinguish an upstream anti-bot / consent interstitial from a real result:
// it masks nothing, but that says nothing about the extension.
const blocked =
  /\/sorry\//.test(nav.href) ||
  /unusual traffic|detected unusual|before you continue|not a robot/i.test(nav.text);

const refusedCardSized = (refusals["too-large"] || 0) + (refusals["contains-inputs"] || 0);
const ok = masked >= 1 && refusedCardSized === 0;

console.log("=== blackout live-check ===");
console.log(`url: ${TARGET}`);
console.log(`landed on: ${nav.href}`);
console.log(`matches: ${matchCount}`);
console.log(`containers masked: ${masked}`);
console.log(
  `refusals: ${Object.keys(refusals).length ? JSON.stringify(refusals) : "none"}`,
);
console.log("--- first 40 [blackout] lines ---");
for (const line of logLines.slice(0, 40)) console.log(line);
if (logLines.length === 0) console.log("(no [blackout] lines; did the debug build load?)");
console.log("---");

if (blocked) {
  console.log(
    "BLOCKED: served an anti-bot/consent interstitial, not news results. " +
      "Inconclusive from this network; run from an unblocked browser.",
  );
  process.exit(2);
}

console.log(
  ok
    ? "PASS: at least one card masked, no card-sized refusals."
    : `FAIL: masked=${masked}, card-sized refusals=${refusedCardSized}.`,
);
process.exit(ok ? 0 : 1);
