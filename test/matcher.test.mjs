// Pure matcher tests (design 5, FR-03): plural/possessive forms, full-name
// rules not firing on a bare first name, Unicode-aware boundaries, exclude
// vetoes, and expiry at match time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileMatcher } from "../src/content/matcher.js";

/**
 * @param {Partial<import("../src/shared/storage.js").FilterProfile>} overrides
 * @returns {import("../src/shared/storage.js").FilterProfile}
 */
function profile(overrides) {
  return {
    id: "p1",
    name: "Test",
    enabled: true,
    includeTerms: [],
    excludeTerms: [],
    matchMode: "phrase",
    expiresAt: null,
    siteScope: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const NOW = 1_000_000;

// A fictional term, so the matcher tests carry no real filter term literal.
const TERM = "Quendle";
const FULL = "Robin Quendle";

test("matches plural and possessive forms", () => {
  const m = compileMatcher([profile({ includeTerms: [TERM] })]);
  for (const text of [
    TERM,
    TERM.toLowerCase(), // case-insensitive
    `the ${TERM}s are back`,
    `${TERM}'s new show`,
    `${TERM}s' empire`,
    `${TERM}’s new show`, // curly apostrophe 's
    `${TERM}s’ empire`, // curly apostrophe s'
  ]) {
    assert.ok(m.match(text, NOW), `should match: ${text}`);
  }
});

test("does not match when the term is only a prefix of a longer word", () => {
  const m = compileMatcher([profile({ includeTerms: [TERM] })]);
  assert.equal(m.match(`${TERM}ize the news`, NOW), null);
});

test("a full-name rule does not fire on a bare first name", () => {
  const m = compileMatcher([profile({ includeTerms: [FULL] })]);
  const first = FULL.split(" ")[0];
  assert.equal(m.match(`${first} went to the store`, NOW), null);
  assert.ok(m.match(`${FULL} attends a gala`, NOW));
});

test("accented letters are word characters, not boundaries", () => {
  const m = compileMatcher([profile({ includeTerms: ["Ana"] })]);
  // "Ana" inside "Anaïs" must not match: the next letter extends the word.
  assert.equal(m.match("Anaïs Nin wrote diaries", NOW), null);
  assert.ok(m.match("Ana went home", NOW));
});

test("excludeTerms veto a match in the same text", () => {
  const m = compileMatcher([
    profile({ includeTerms: ["Jordan"], excludeTerms: ["Michael Jordan"] }),
  ]);
  assert.equal(m.match("Michael Jordan scored 40", NOW), null);
  assert.ok(m.match("the Jordan River is beautiful", NOW));
});

test("expiry is checked at match time", () => {
  const m = compileMatcher([
    profile({ includeTerms: ["Survivor"], expiresAt: 1500 }),
  ]);
  assert.ok(m.match("Survivor finale tonight", 1000), "not yet expired");
  assert.equal(m.match("Survivor finale tonight", 2000), null, "expired");
});

test("disabled profiles do not match", () => {
  const m = compileMatcher([
    profile({ includeTerms: [TERM], enabled: false }),
  ]);
  assert.ok(m.isEmpty);
  assert.equal(m.match(`${TERM} news`, NOW), null);
});

test("returns which profile matched", () => {
  const m = compileMatcher([
    profile({ id: "a", name: "Spoilers", includeTerms: ["Survivor"] }),
    profile({ id: "b", name: "Celebs", includeTerms: [TERM] }),
  ]);
  assert.deepEqual(m.match(`${TERM} spotted`, NOW), {
    profileId: "b",
    term: TERM,
  });
});
