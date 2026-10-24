// Live check: load the built extension in a real Chromium, open a page, and
// report what the content script decided. Requires a debug build:
// `npm run build -- --debug` first.
//
//   node scripts/live-check.mjs [url] [--reveal]
//
// Default url is a Google News search. --reveal: for every masked element, find
// our Reveal button, report what document.elementFromPoint says is on top at its
// centre, then perform a real mouse click (and a keyboard Enter) and report
// whether the mask toggled. Exit 0 when every mask toggles on a real click.

import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(root, "dist", "chrome");
const argv = process.argv.slice(2);
const revealMode = argv.includes("--reveal");
const TARGET = argv.find((a) => !a.startsWith("--")) || "https://news.google.com/search?q=Kardashian";
const SETTLE_MS = 20_000;

const logLines = [];
const userDataDir = await mkdtemp(join(tmpdir(), "blackout-live-"));

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

let masked = 0;
let nestedMasks = 0;
let nav = { href: TARGET, title: "", text: "" };
let revealResults = [];

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
    // Streaming pages never go idle; settling by timeout is fine.
  }
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  nav = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : "").slice(0, 300),
  }));
  masked = await page.locator(".blackout-ui").count();
  nestedMasks = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll(".blackout-blacked-out")) {
      if (el.parentElement && el.parentElement.closest(".blackout-blacked-out")) n++;
    }
    return n;
  });

  const blockedNow =
    /\/sorry\//.test(nav.href) || /unusual traffic|detected unusual|before you continue|not a robot/i.test(nav.text);

  if (revealMode && !blockedNow) {
    for (let i = 0; i < masked; i++) {
      // Bring the mask into view, let any lazy reflow settle, then read the
      // Reveal button's centre and the element actually on top there.
      await page.evaluate((idx) => {
        document.querySelectorAll(".blackout-ui")[idx]?.scrollIntoView({ block: "center", inline: "center" });
      }, i);
      await page.waitForTimeout(250);
      const probe = await page.evaluate((idx) => {
        const host = document.querySelectorAll(".blackout-ui")[idx];
        if (!host) return { ok: false };
        const btn = host.shadowRoot && host.shadowRoot.querySelector("button");
        if (!btn) return { ok: false, reason: "no button" };
        const r = btn.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(cx, cy);
        const describe = (el) =>
          !el
            ? "(none)"
            : el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : "") +
              (typeof el.className === "string" && el.className.trim()
                ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
                : "");
        const ours = !!top && (top === host || host.contains(top) || (top.classList && top.classList.contains("blackout-ui")));
        const inView = cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight;
        return { ok: true, cx, cy, inView, top: describe(top), ours, before: btn.textContent };
      }, i);

      if (!probe.ok || !probe.inView) {
        revealResults.push({ i, ...probe, mouseToggled: false, skipped: true });
        continue;
      }

      // Tag the masked container so we can find this exact story again even if
      // the page re-renders or replaces its node, and record its text.
      await page.evaluate((idx) => {
        const host = document.querySelectorAll(".blackout-ui")[idx];
        const container = host && host.parentElement;
        if (container) container.setAttribute("data-bo-story", String(idx));
      }, i);

      const logMark = logLines.length;
      await page.mouse.click(probe.cx, probe.cy);

      // Sample the story at 0, 250, 1000 and 3000 ms after the click.
      const sampleAt = [0, 250, 1000, 3000];
      const samples = [];
      let waited = 0;
      for (const t of sampleAt) {
        if (t > waited) {
          await page.waitForTimeout(t - waited);
          waited = t;
        }
        const s = await page.evaluate((idx) => {
          const tagged = document.querySelector(`[data-bo-story="${idx}"]`);
          if (!tagged) return { t: 0, replaced: true, found: false, blackedOut: false, revealed: false };
          const blackedOut = tagged.classList.contains("blackout-blacked-out");
          const host = tagged.querySelector(":scope > .blackout-ui");
          const btn = host && host.shadowRoot && host.shadowRoot.querySelector("button");
          return {
            replaced: false,
            found: true,
            blackedOut,
            revealed: !blackedOut && !!btn && btn.textContent === "Black out again",
          };
        }, i);
        samples.push({ t, ...s });
      }

      const remaskLogs = logLines.slice(logMark).filter((l) => /^(container masked|reverify reapplied)/.test(l));
      const first = samples[0];
      const last = samples[samples.length - 1];
      revealResults.push({
        i,
        top: probe.top,
        ours: probe.ours,
        mouseToggled: first.revealed,
        revealedAt: samples.map((s) => `${s.t}:${s.replaced ? "replaced" : s.revealed ? "revealed" : "BLACK"}`).join(" "),
        stillRevealed: last.revealed,
        remaskPaths: [...new Set(remaskLogs.map((l) => l.split(" ")[0] + (l.startsWith("reverify") ? " reapplied" : " masked")))],
      });
    }
  }
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
const blocked =
  /\/sorry\//.test(nav.href) || /unusual traffic|detected unusual|before you continue|not a robot/i.test(nav.text);

console.log("=== blackout live-check ===");
console.log(`url: ${TARGET}`);
console.log(`landed on: ${nav.href}`);
console.log(`matches: ${matchCount}   containers masked: ${masked}   nested masks: ${nestedMasks} (must be 0)`);
console.log(`refusals: ${Object.keys(refusals).length ? JSON.stringify(refusals) : "none"}`);
console.log(`[blackout] log lines: ${logLines.length}${logLines.length ? "  e.g. " + JSON.stringify(logLines.slice(0, 3)) : " (content script produced none)"}`);

if (blocked) {
  console.log("BLOCKED: served an anti-bot/consent interstitial, not real content. Stop; run from an unblocked browser.");
  process.exit(2);
}

if (revealMode) {
  console.log("--- reveal probes (click, then sampled at 0/250/1000/3000 ms) ---");
  for (const r of revealResults) {
    if (r.skipped) {
      console.log(`  [${r.i}] skipped (${r.reason || "offscreen"})`);
      continue;
    }
    console.log(
      `  [${r.i}] ours=${r.ours} click=${r.mouseToggled ? "revealed" : "stuck"}  ${r.revealedAt}` +
        (r.remaskPaths.length ? `  re-masked-by: ${r.remaskPaths.join(", ")}` : ""),
    );
  }
  const clickable = revealResults.filter((r) => !r.skipped);
  const allStayRevealed = clickable.length > 0 && clickable.every((r) => r.stillRevealed);
  const pass = allStayRevealed && nestedMasks === 0;
  console.log("---");
  console.log(
    pass
      ? `PASS: all ${clickable.length} stories still revealed at 3000 ms; no nested masks.`
      : `FAIL: ${clickable.filter((r) => r.stillRevealed).length}/${clickable.length} still revealed at 3000 ms; nested masks=${nestedMasks}.`,
  );
  process.exit(pass ? 0 : 1);
}

const ok = masked >= 1 && (refusals["too-large"] || 0) + (refusals["contains-inputs"] || 0) === 0;
console.log(ok ? "PASS: at least one card masked, no card-sized refusals." : `FAIL: masked=${masked}.`);
process.exit(ok ? 0 : 1);
