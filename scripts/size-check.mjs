// Size check (design 8c): serve a local fixture with matching cards at a grid
// of heights and widths, load it with the extension in Playwright, and for
// every mask assert the Reveal button is fully inside the mask area and hit-
// testable, then real-click it and confirm it toggles. jsdom can't do layout,
// so this runs in a real browser. Build first (`npm run build`).

import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import starterConfig from "../src/config/starter-profiles.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(root, "dist", "chrome");
const TERM = starterConfig[0].includeTerms[0]; // read from config, never hard-coded

const HEIGHTS = [400, 120, 60, 40, 24, 16, 10];
const WIDTHS = [600, 300, 150, 80];

// A matching card per height x width. Each has a unique class so no three share
// a signature: that keeps them per-card masks (not a whole-page cover) while
// still card-like by class. box-sizing:border-box so the inline height is the
// measured height.
function fixtureHtml() {
  const cards = [];
  for (const h of HEIGHTS) {
    for (const w of WIDTHS) {
      cards.push(
        `<section class="card sz-${h}-${w}" data-h="${h}" data-w="${w}" ` +
          `style="box-sizing:border-box;overflow:hidden;height:${h}px;width:${w}px;margin:12px;background:#eee">` +
          `<h3 style="margin:0">${TERM} news update ${h} by ${w}</h3>` +
          `<p style="margin:0">Some supporting copy about the story.</p>` +
          `</section>`,
      );
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Size fixture</title></head>` +
    `<body style="margin:0;padding:16px;font-family:system-ui">${cards.join("")}</body></html>`;
}

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fixtureHtml());
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const userDataDir = await mkdtemp(join(tmpdir(), "blackout-size-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

const rows = [];
try {
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(url, { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(500);

  const count = await page.locator(".blackout-ui").count();
  for (let i = 0; i < count; i++) {
    await page.evaluate((idx) => {
      document.querySelectorAll(".blackout-ui")[idx]?.scrollIntoView({ block: "center" });
    }, i);
    await page.waitForTimeout(60);

    const probe = await page.evaluate((idx) => {
      const host = document.querySelectorAll(".blackout-ui")[idx];
      const card = host.parentElement;
      const btn = host.shadowRoot.querySelector("button");
      const hr = host.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const eps = 0.5;
      const inside =
        br.left >= hr.left - eps &&
        br.top >= hr.top - eps &&
        br.right <= hr.right + eps &&
        br.bottom <= hr.bottom + eps;
      // elementFromPoint at the button centre and its four inner corners must
      // resolve to our host (the button lives in its shadow root).
      const inset = 3;
      const pts = [
        [br.left + br.width / 2, br.top + br.height / 2],
        [br.left + inset, br.top + inset],
        [br.right - inset, br.top + inset],
        [br.left + inset, br.bottom - inset],
        [br.right - inset, br.bottom - inset],
      ];
      const ours = pts.every(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        return !!top && (top === host || host.contains(top) || (top.classList && top.classList.contains("blackout-ui")));
      });
      return {
        h: card.getAttribute("data-h"),
        w: card.getAttribute("data-w"),
        btnHeight: Math.round(br.height),
        inside,
        ours,
        cx: Math.round(br.left + br.width / 2),
        cy: Math.round(br.top + br.height / 2),
        before: btn.textContent,
      };
    }, i);

    await page.mouse.click(probe.cx, probe.cy);
    const after = await page.evaluate(
      (idx) => document.querySelectorAll(".blackout-ui")[idx]?.shadowRoot.querySelector("button").textContent,
      i,
    );
    rows.push({ ...probe, toggled: after !== probe.before, btnBig: probe.btnHeight >= 24 });
  }
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
  server.close();
}

rows.sort((a, b) => b.h - a.h || b.w - a.w);
console.log("=== blackout size check ===");
console.log(`term: ${TERM}   masks: ${rows.length}`);
console.log("  h x w     btn>=24  inside  hit-top  toggles");
let allPass = rows.length > 0;
for (const r of rows) {
  const pass = r.btnBig && r.inside && r.ours && r.toggled;
  if (!pass) allPass = false;
  console.log(
    `  ${String(r.h).padStart(3)}x${String(r.w).padEnd(3)}   ` +
      `${r.btnBig ? "yes" : "NO "}      ${r.inside ? "yes" : "NO "}     ${r.ours ? "yes" : "NO "}      ${r.toggled ? "yes" : "NO "}` +
      (pass ? "" : "   <- FAIL"),
  );
}
console.log("---");
console.log(allPass ? "PASS: every mask keeps Reveal fully visible and clickable." : "FAIL: see rows above.");
process.exit(allPass ? 0 : 1);
