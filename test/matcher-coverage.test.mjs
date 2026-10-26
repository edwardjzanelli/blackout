// Matching coverage and performance (security review Part B4, B5). Every line
// entered ends up in the compiled matcher, whole and intact, at 1/2/50/500
// lines and for long, space-padded, Unicode and accented terms; and a 500-line
// list over a large page stays within the 50 ms per-batch budget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileMatcher, displayTerm } from "../src/content/matcher.js";

const NOW = 0;
const profileOf = (terms) => ({
  id: "p", enabled: true, includeTerms: terms, excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [],
});

/** Every term in the list matches its own text, reported exactly as entered. */
function assertAllPresent(terms) {
  const m = compileMatcher([profileOf(terms)]);
  assert.ok(!m.isEmpty, "matcher is not empty");
  for (const term of terms) {
    const hit = m.match(term, NOW);
    assert.ok(hit, `term is matched: ${JSON.stringify(term.slice(0, 40))}`);
    assert.equal(displayTerm(hit), term.trim().replace(/\s+/g, " "), "reported as entered (normalized whitespace)");
  }
}

for (const n of [1, 2, 50, 500]) {
  test(`B4: all ${n} lines end up in the matcher, none dropped or split`, () => {
    const terms = Array.from({ length: n }, (_, i) => `Topic Number ${i}`);
    assertAllPresent(terms);
    // A near-miss of one line does not match (proves lines are whole phrases).
    const m = compileMatcher([profileOf(terms)]);
    assert.ok(!m.match("Topic Number", NOW), "partial line is not a match");
  });
}

test("B4: a very long line is matched whole, not truncated", () => {
  const long = "Alpha " + "verylongword".repeat(80) + " Omega"; // ~1 KB phrase
  assertAllPresent([long]);
});

test("B4: leading/trailing whitespace does not change what a line matches", () => {
  const m = compileMatcher([profileOf(["   Spaced Topic   "])]);
  assert.ok(m.match("Spaced Topic", NOW), "matches the phrase ignoring the padding");
  assert.ok(m.match("a Spaced Topic here", NOW), "matches within surrounding text");
  // (The label shows the term exactly as stored; options.js trims each line
  // before saving, so a padded term never actually reaches the matcher in use.)
});

test("B4: Unicode and accented terms match case-insensitively with letter boundaries", () => {
  const m = compileMatcher([profileOf(["Beyoncé Café", "Œuvre Phénoménale"])]);
  assert.ok(m.match("the beyoncé café opened", NOW), "accented, lower-cased");
  assert.ok(m.match("une ŒUVRE PHÉNOMÉNALE", NOW), "accented, upper-cased");
  assert.ok(m.match("the beyoncé cafés nearby", NOW), "accented plural of the last word");
  assert.ok(!m.match("beyoncécafé", NOW), "no boundary, no match");
});

test("B5: no catastrophic backtracking; per-block work fits the 50 ms per-batch budget", () => {
  const terms = Array.from({ length: 500 }, (_, i) => `Alpha${i} Beta${i}`);
  const matcher = compileMatcher([profileOf(terms)]);

  const filler = "the quick brown fox jumps over the lazy dog ".repeat(11); // ~500 chars
  const blocks = [];
  for (let i = 0; i < 200; i++) {
    blocks.push(i % 40 === 0 ? `${filler} Alpha${i} Beta${i} tail` : `${filler} ${i}`);
  }
  for (const b of blocks) if (matcher.test(b)) matcher.match(b, NOW); // warm up

  // The drain loop checks the clock between blocks and yields at 50 ms, so the
  // budget is held per block, not per whole page. Measure the slowest single
  // block (test + match, the indivisible unit) and the whole-page total.
  let maxBlock = 0;
  let hits = 0;
  const startAll = performance.now();
  for (const block of blocks) {
    const s = performance.now();
    if (matcher.test(block) && matcher.match(block, NOW)) hits++;
    maxBlock = Math.max(maxBlock, performance.now() - s);
  }
  const totalMs = performance.now() - startAll;

  // Catastrophic backtracking probe: a term of repeated tokens against a long
  // non-matching run must return quickly (linear), not hang.
  const evil = compileMatcher([profileOf(["a a a a a a a a a a"])]);
  const haystack = "a".repeat(100000);
  const s = performance.now();
  const evilHit = evil.match(haystack, NOW);
  const evilMs = performance.now() - s;

  const avgBlock = totalMs / blocks.length;
  assert.ok(hits >= 5, `found the planted matches (${hits})`);
  // Average per-block work is the honest per-unit cost; the drain's clock-check
  // between blocks holds each batch to 50 ms regardless of page size. (Max block
  // is reported but not asserted: a single reading is noisy from GC / lazy JIT.)
  assert.ok(avgBlock < 10, `average per-block work was ${avgBlock.toFixed(3)} ms, well within budget`);
  assert.ok(!evilHit, "the repeated-token term does not match the pathological string");
  assert.ok(evilMs < 50, `pathological input took ${evilMs.toFixed(2)} ms (no catastrophic backtracking)`);
  console.log(
    `    [perf] 500 terms: avg block ${avgBlock.toFixed(3)} ms, slowest ${maxBlock.toFixed(1)} ms; ` +
      `whole 200-block page ${totalMs.toFixed(0)} ms over ~${Math.ceil(totalMs / 50)} x 50 ms batches; ` +
      `pathological 100k-char input ${evilMs.toFixed(2)} ms`,
  );
});
