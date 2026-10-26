// Matching correctness (security review Part B1, B2, B6). Uses an invented
// phrase "The Quendles" that mirrors Ed's two-word example exactly; the real
// starter term is never written in a test file (design 6.3, enforced by
// no-term-literals.test.mjs). Each line is one whole phrase: boundaries only at
// the two ends, internal whitespace matches any run, plural/possessive on the
// last word only, and user text is never interpreted as a regex.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileMatcher } from "../src/content/matcher.js";

const NOW = 0;
const NBSP = " ";
function withTerm(term) {
  return compileMatcher([
    { id: "p", enabled: true, includeTerms: [term], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [] },
  ]);
}
const hits = (term, text) => !!withTerm(term).match(text, NOW);

test("B1: regex metacharacters in a term are literal, never thrown, never wild", () => {
  const cases = [".*", "(", ")", "a+b", "[x]", "\\", "$1", "^$", "(?:)", "a|b", "{2}", "?"];
  for (const term of cases) {
    let m;
    assert.doesNotThrow(() => (m = withTerm(term)), `compiling ${JSON.stringify(term)} must not throw`);
    assert.doesNotThrow(() => m.match("anything at all here", NOW), `matching ${JSON.stringify(term)} must not throw`);
    assert.ok(m.match(term, NOW), `${JSON.stringify(term)} matches its own literal text`);
    assert.ok(!m.match("zzz unrelated words zzz", NOW), `${JSON.stringify(term)} does not match arbitrary text`);
  }
});

test("B1: '.*' is literal, not a wildcard", () => {
  const m = withTerm(".*");
  assert.ok(!m.match("literally anything", NOW), "does not match an arbitrary string");
  assert.ok(m.match("a .* b", NOW), "matches the literal characters .*");
});

test("B2: internal whitespace matches any run (spaces, tab, newline, non-breaking space)", () => {
  const term = "The Quendles";
  assert.ok(hits(term, "The Quendles"));
  assert.ok(hits(term, "The  Quendles"), "two spaces");
  assert.ok(hits(term, "The\tQuendles"), "tab");
  assert.ok(hits(term, "The\nQuendles"), "newline");
  assert.ok(hits(term, `The${NBSP}Quendles`), "non-breaking space");
  assert.ok(hits(term, `The ${NBSP}\n Quendles`), "a mixed run of whitespace");
});

test("B2: plural/possessive apply to the phrase's last word only", () => {
  const term = "The Quendle"; // singular last word
  assert.ok(hits(term, "The Quendle"));
  assert.ok(hits(term, "The Quendles"), "plural of last word");
  assert.ok(hits(term, "The Quendle's"), "possessive of last word");
  assert.ok(hits(term, "The Quendles'"), "plural possessive of last word");
  assert.ok(!hits(term, "Thes Quendle"), "first word is not pluralized");
});

test("B2: a phrase is not matched by either word alone or run together", () => {
  const term = "The Quendles";
  assert.ok(!hits(term, "The"), "first word alone");
  assert.ok(!hits(term, "Quendles"), "last word alone");
  assert.ok(!hits(term, "TheQuendles"), "run together, no space");
  assert.ok(!hits(term, "The Quendle family"), "a different trailing word");
});

test("B6: Ed's example set, mirrored with an invented phrase", () => {
  const term = "The Quendles";
  // Mask these:
  assert.ok(hits(term, "The Quendles"));
  assert.ok(hits(term, "the  quendles"), "case-insensitive, extra space");
  assert.ok(hits(term, "The Quendles'"), "trailing apostrophe");
  assert.ok(hits(term, "I watched The Quendles last night"), "inside a sentence");
  // Do not mask these:
  assert.ok(!hits(term, "The"));
  assert.ok(!hits(term, "Quendles"));
  assert.ok(!hits(term, "The Quendle family"), "phrase is plural, text is singular + family");
  assert.ok(!hits(term, "TheQuendles"));
});

test("B2: an excludeTerm still vetoes, and matching stays literal under exclude", () => {
  const m = compileMatcher([
    { id: "p", enabled: true, includeTerms: ["The Quendles"], excludeTerms: ["(review)"], matchMode: "phrase", expiresAt: null, siteScope: [] },
  ]);
  assert.ok(m.match("The Quendles are back", NOW));
  assert.ok(!m.match("The Quendles (review) today", NOW), "exclude term vetoes, parens literal");
});
