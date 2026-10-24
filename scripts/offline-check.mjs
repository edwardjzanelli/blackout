// Offline check: load a saved HTML file into jsdom, run the real matcher +
// scan walker + container resolver + overlay over it, and report what was masked
// and what stayed visible and why. Used to find matches that stay visible
// without a live browser.
//
// Usage: node scripts/offline-check.mjs <path-to-saved.html> [--no-page-rule] [--host=<hostname>]
//
//   --no-page-rule  Disable whole-page rule 1 (title/URL) and rule 2 (enough
//                   stories), so per-card masking can be checked on search pages
//                   that would otherwise be covered whole.
//   --host=<h>      Hostname used to pick the site adapter (default: inferred
//                   from the file name). Terms still come only from the config.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import { ruleOneTerm, storyCounts, shouldCoverByStories, shouldCoverByRefs, countReferences } from "../src/content/whole-page.js";
import { unitSelectorFor } from "../src/adapters/index.js";
import * as overlay from "../src/content/overlay.js";
import starterConfig from "../src/config/starter-profiles.json" with { type: "json" };

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const noPageRule = argv.includes("--no-page-rule");
const hostArg = (argv.find((a) => a.startsWith("--host=")) || "").slice("--host=".length);
if (!file) {
  console.error("usage: node scripts/offline-check.mjs <saved.html> [--no-page-rule] [--host=<hostname>]");
  process.exit(2);
}

const ATTRS = ["title", "aria-label", "alt"];
// Terms come only from the config (design 6.3), never hard-coded here.
const profiles = starterConfig.map((p) => ({ ...p, enabled: p.enabled !== false }));

const html = await readFile(file, "utf8");
const dom = new JSDOM(html);
const { document } = dom.window;
const matcher = compileMatcher(profiles);

// Pick the site adapter by host; fall back to the file name (youtube.html ->
// youtube.com) so saved captures resolve to the right selectors.
const host = hostArg || `${basename(file).replace(/\.html?$/i, "")}.com`;
const extraUnits = unitSelectorFor(host);

function desc(el) {
  if (!el) return "(none)";
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute && el.getAttribute("role");
  const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  return tag + (role ? `[role=${role}]` : "") + (cls ? "." + cls : "");
}
function unitKey(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute && el.getAttribute("role");
  return tag + (role ? `[role=${role}]` : "");
}
function snippet(t) {
  return t.replace(/\s+/g, " ").trim().slice(0, 55);
}

// Whole-page rule 1 by title (saved files carry no live URL search string).
if (!noPageRule) {
  const hit = ruleOneTerm(matcher, { title: document.title || "", search: "" }, Date.now());
  if (hit) {
    console.log(`file: ${file}`);
    console.log(`WHOLE-PAGE COVER via rule 1 (title contains "${hit.term}"); run with --no-page-rule to check cards.`);
    process.exit(0);
  }
}

const active = new Set();
const rows = [];
const walker = makeCandidateWalker(document, document.body, () => false);
let node;
while ((node = walker.nextNode())) {
  let element = null;
  let text = "";
  let kind = "text";
  if (node.nodeType === 3) {
    element = node.parentElement;
    text = node.nodeValue || "";
  } else if (node.nodeType === 1) {
    element = node;
    kind = "attr";
    text = ATTRS.map((a) => node.getAttribute(a)).filter(Boolean).join(" ");
  }
  if (!element || !text.trim() || !matcher.test(text)) continue;
  const hit = matcher.match(text, Date.now());
  if (!hit) continue;

  const decision = findContainer(element, dom.window, extraUnits);
  const container = decision.container;
  let outcome;
  if (container) {
    // Masks never nest (design 3.6): a match inside an already-masked unit does
    // not make a second mask.
    if (container.closest(".blackout-blacked-out") && !active.has(container)) {
      continue;
    }
    if (!active.has(container)) {
      overlay.blackout(container, hit.term, { window: dom.window });
      active.add(container);
    }
    outcome = `MASKED ${desc(container)}`;
  } else {
    outcome = `VISIBLE (refused ${decision.reason} at ${desc(decision.element)})`;
  }
  rows.push({ visible: !container, kind, term: hit.term, in: desc(element), outcome, text: snippet(text) });
}

const visible = rows.filter((r) => r.visible);

// References to filter terms on the page (design 3.6 rule 2): distinct elements
// that own a match. Reported for every file so the saved Facebook search page
// shows whether the reference rule alone would have covered it.
const refs = countReferences(document.body, matcher, dom.window, () => false);
const prefs = { pageCoverRatio: 0.5, pageCoverMinMatches: 6, pageCoverMaxRefs: 10 };
const refsWouldCover = shouldCoverByRefs(refs, prefs);

// Whole-page rule 2 (enough detected stories match, or enough references),
// unless disabled.
let rule2 = false;
if (!noPageRule) {
  rule2 = shouldCoverByStories(storyCounts(active), prefs) || refsWouldCover;
}

const unitCounts = new Map();
for (const el of active) unitCounts.set(unitKey(el), (unitCounts.get(unitKey(el)) || 0) + 1);

console.log(`file: ${file}`);
console.log(`adapter host: ${host}   page-rule: ${noPageRule ? "OFF (--no-page-rule)" : "on"}`);
console.log(`total matches: ${rows.length}   masked units: ${active.size}   left VISIBLE: ${visible.length}`);
console.log(`references (distinct elements owning a match): ${refs}   reference rule (>10) alone covers: ${refsWouldCover ? "YES" : "no"}`);
if (rule2) console.log(`(rule 2 would cover the whole page)`);
console.log("");
console.log("=== masked units (tag/role x count) ===");
if (unitCounts.size) {
  for (const [k, n] of [...unitCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
} else {
  console.log("  (none)");
}
console.log("");
if (visible.length) {
  console.log("=== matches left VISIBLE ===");
  for (const r of visible) {
    console.log(`  [${r.kind}] term="${r.term}" in <${r.in}> -> ${r.outcome}`);
    console.log(`         text: "${r.text}"`);
  }
} else {
  console.log("no matches left visible.");
}
