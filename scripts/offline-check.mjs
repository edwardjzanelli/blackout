// Offline check: load a saved HTML file into jsdom, run the real matcher +
// scan walker + container + overlay over it, and print one line per matching
// text node or attribute showing what was masked or refused and why. Used to
// find matches that stay visible without a live browser.
//
// Usage: node scripts/offline-check.mjs <path-to-saved.html>

import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { compileMatcher } from "../src/content/matcher.js";
import { makeCandidateWalker } from "../src/content/scan.js";
import { findContainer } from "../src/content/container.js";
import * as overlay from "../src/content/overlay.js";
import starterConfig from "../src/config/starter-profiles.json" with { type: "json" };

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/offline-check.mjs <saved.html>");
  process.exit(2);
}

const ATTRS = ["title", "aria-label", "alt"];
// Terms come only from the config (design 6.3), never hard-coded here.
const profiles = starterConfig.map((p) => ({ ...p, enabled: p.enabled !== false }));

const html = await readFile(file, "utf8");
const dom = new JSDOM(html);
const { document } = dom.window;
const matcher = compileMatcher(profiles);

function desc(el) {
  if (!el) return "(none)";
  const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
}
function snippet(t) {
  return t.replace(/\s+/g, " ").trim().slice(0, 55);
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

  const decision = findContainer(element, dom.window);
  const container = decision.container;
  let outcome;
  if (container) {
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
console.log(`file: ${file}`);
console.log(`total matches: ${rows.length}   masked containers: ${active.size}   left VISIBLE: ${visible.length}`);
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
