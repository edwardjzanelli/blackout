// UI check (design 3.1, 3.2): in a real browser with the built extension, open
// the options page by its extension URL, add filters, confirm a local fixture
// masks them, drive the popup's pause / site-pause and page count, and confirm
// deleting a line unmasks its stories after Save. Build first (`npm run build`).

import { chromium } from "playwright";
import { createServer } from "node:http";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import starterConfig from "../src/config/starter-profiles.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_TERM = "Zzyzxia"; // exists only here, never in src
const STARTER_TERM = starterConfig[0].includeTerms[0]; // read from config

/** A manifest `key` and the extension id Chrome derives from it. */
function makeKeyAndId() {
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  const der = publicKey;
  const hash = createHash("sha256").update(der).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4)) + String.fromCharCode(97 + (hash[i] & 0xf));
  }
  return { key: der.toString("base64"), id };
}

function fixtureHtml() {
  const card = (id, text) =>
    `<section class="card c-${id}" id="${id}" style="box-sizing:border-box;min-height:120px;margin:12px;background:#eee">` +
    `<h3 style="margin:0">${text}</h3><p>Some supporting copy.</p></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>UI fixture</title></head><body style="margin:0;padding:16px">` +
    card("fix", `${FIXTURE_TERM} breaking story`) +
    card("star", `${STARTER_TERM} in the news today`) +
    card("none", "Local weather and sports recap") +
    `</body></html>`;
}

const results = [];
const check = (name, ok) => results.push({ name, ok: !!ok });

// --- temp extension copy with a stable id ---
const extDir = await mkdtemp(join(tmpdir(), "blackout-ext-"));
await cp(join(root, "dist", "chrome"), extDir, { recursive: true });
const { key, id } = makeKeyAndId();
const manifestPath = join(extDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.key = key;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fixtureHtml());
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

const userDataDir = await mkdtemp(join(tmpdir(), "blackout-ui-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

const optionsUrl = `chrome-extension://${id}/options/options.html`;
const popupUrl = `chrome-extension://${id}/popup/popup.html`;
const maskCount = (p) => p.locator(".blackout-ui").count();
const isMasked = (p, sel) => p.locator(`${sel}.blackout-blacked-out`).count().then((n) => n > 0);

try {
  const fixture = context.pages()[0] || (await context.newPage());

  // Options: set the box to the fixture term + the starter term, then Save.
  const options = await context.newPage();
  await options.goto(optionsUrl, { waitUntil: "load" });
  await options.waitForSelector("#block-list");
  await options.fill("#block-list", `${FIXTURE_TERM}\n${STARTER_TERM}`);
  await options.click("#block-form button[type=submit]");
  await options.waitForSelector("#saved-note:not([hidden])", { timeout: 4000 }).catch(() => {});
  check("options: Save shows the Saved confirmation", !(await options.locator("#saved-note").getAttribute("hidden").catch(() => "x")));

  // Fixture masks both terms, not the unrelated card.
  await fixture.goto(fixtureUrl, { waitUntil: "load" });
  await fixture.waitForTimeout(600);
  check("fixture: the fixture-term card is masked", await isMasked(fixture, "#fix"));
  check("fixture: the starter-term card is masked", await isMasked(fixture, "#star"));
  check("fixture: the unrelated card is not masked", !(await isMasked(fixture, "#none")));

  // Popup. Keep the fixture the active tab (Playwright interactions don't change
  // the active tab), and nudge the popup to re-read via a focus event, so its
  // "active tab" reads resolve to the fixture, like a real toolbar popup.
  const popup = await context.newPage();
  await popup.goto(popupUrl, { waitUntil: "load" });
  await popup.waitForSelector("#on-switch");
  await fixture.bringToFront();
  await popup.evaluate(() => window.dispatchEvent(new Event("focus")));
  await popup.waitForTimeout(250);

  const maskedBefore = await maskCount(fixture);
  await popup.uncheck("#on-switch"); // turn Blackout off (pause)
  await fixture.waitForTimeout(500);
  check("popup: Pause clears all masks", (await maskCount(fixture)) === 0);
  await popup.check("#on-switch"); // on again
  await fixture.waitForTimeout(600);
  check("popup: unpause restores masks", (await maskCount(fixture)) === maskedBefore);

  // Popup: per-site pause behaves the same.
  await popup.check("#site-switch"); // pause on this site
  await fixture.waitForTimeout(500);
  check("popup: site pause clears masks", (await maskCount(fixture)) === 0);
  await popup.uncheck("#site-switch");
  await fixture.waitForTimeout(600);
  check("popup: un-pausing the site restores masks", (await maskCount(fixture)) === maskedBefore);

  // Popup page count matches the masks on the active tab.
  await popup.evaluate(() => window.dispatchEvent(new Event("focus")));
  await popup.waitForTimeout(400);
  const pageLine = await popup.locator("#page-count").textContent();
  const reported = Number((pageLine.match(/(\d+)/) || [])[1]);
  const masks = await maskCount(fixture);
  check(`popup: page count matches masks (${reported} == ${masks})`, reported === masks);

  // Delete a line (remove the fixture term), Save: its story unmasks, the other stays.
  await options.bringToFront();
  await options.fill("#block-list", STARTER_TERM);
  await options.click("#block-form button[type=submit]");
  await options.waitForTimeout(300);
  await fixture.bringToFront();
  await fixture.waitForTimeout(700);
  check("delete line: the fixture-term story unmasks after Save", !(await isMasked(fixture, "#fix")));
  check("delete line: the starter-term story stays masked", await isMasked(fixture, "#star"));
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
  await rm(extDir, { recursive: true, force: true });
  server.close();
}

console.log("=== blackout UI check ===");
let allPass = results.length > 0;
for (const r of results) {
  if (!r.ok) allPass = false;
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
}
console.log("---");
console.log(allPass ? "PASS: options, popup pause/site/count, and delete all work." : "FAIL: see rows above.");
process.exit(allPass ? 0 : 1);
