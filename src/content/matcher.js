// Matching module (design 5): pure, no DOM. Compile active profiles into one
// matcher. Case-insensitive, Unicode-normalized, Unicode-aware word boundaries
// (never \b, per 5.1a), plural and possessive forms, excludeTerms veto, and
// expiry checked at match time (6.1).

/** Right single quotation mark (curly apostrophe), U+2019. */
const CURLY = "’";

/**
 * Optional trailing plural/possessive forms a term also matches: s, es, 's, s',
 * and the curly-apostrophe variants (design FR-03). Longer forms first so the
 * alternation prefers them.
 */
const SUFFIX = `(?:es|'s|${CURLY}s|s'|s${CURLY}|s)?`;

/**
 * Normalize for comparison: NFKC, collapse runs of whitespace to one space,
 * trim ends (design 5.1).
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return String(text).normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} s
 * @returns {string} s with regex metacharacters escaped
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the pattern for one term: Unicode-aware boundaries using \p{L}\p{N}
 * lookarounds (not \b, which treats accented letters as boundaries), with the
 * optional plural/possessive suffix.
 * @param {string} term
 * @returns {string|null}
 */
function termPattern(term) {
  const normalized = normalize(term);
  if (!normalized) return null;
  return `(?<![\\p{L}\\p{N}])${escapeRegExp(normalized)}${SUFFIX}(?![\\p{L}\\p{N}])`;
}

/**
 * @param {string[]} terms
 * @returns {RegExp|null}
 */
function termsToRegExp(terms) {
  const patterns = terms.map(termPattern).filter(Boolean);
  if (patterns.length === 0) return null;
  return new RegExp(patterns.join("|"), "iu");
}

/**
 * @param {string} term
 * @returns {RegExp|null}
 */
function termToRegExp(term) {
  const pattern = termPattern(term);
  return pattern ? new RegExp(pattern, "iu") : null;
}

/**
 * @typedef {Object} CompiledProfile
 * @property {string} id
 * @property {number|null} expiresAt
 * @property {{term: string, re: RegExp}[]} terms include terms kept as entered
 * @property {RegExp|null} exclude
 */

/**
 * @typedef {Object} Match
 * @property {string} profileId
 * @property {string} term the matched include term, exactly as entered
 */

/**
 * @typedef {Object} Matcher
 * @property {boolean} isEmpty
 * @property {(text: string) => boolean} test quick combined include test (5.1a)
 * @property {(text: string, now: number) => Match|null} match
 */

/**
 * The single source of display text for a match: the include term as the user
 * entered it. Every surface (card label, whole-page cover) renders this; no
 * rendering code reads a profile name (design 3.3, 3.6, 6.3).
 * @param {Match|null} hit
 * @returns {string}
 */
export function displayTerm(hit) {
  return hit ? hit.term : "";
}

/**
 * Compile all enabled profiles into one matcher. Expiry is intentionally not
 * applied here; it is checked per call in match() so one compiled matcher stays
 * correct as time passes (design 6.1).
 * @param {import("../shared/storage.js").FilterProfile[]} profiles
 * @returns {Matcher}
 */
export function compileMatcher(profiles) {
  /** @type {CompiledProfile[]} */
  const compiled = [];
  for (const profile of profiles || []) {
    if (!profile || !profile.enabled) continue;
    const terms = [];
    for (const term of profile.includeTerms || []) {
      const re = termToRegExp(term);
      if (re) terms.push({ term, re });
    }
    if (terms.length === 0) continue;
    compiled.push({
      id: profile.id,
      expiresAt: profile.expiresAt ?? null,
      terms,
      exclude: termsToRegExp(profile.excludeTerms || []),
    });
  }

  // One combined regex across every include pattern, for the cheap "is there
  // any hit at all" prefilter in the content script (design 5.1a).
  const combined = compiled.length
    ? new RegExp(compiled.flatMap((c) => c.terms.map((t) => t.re.source)).join("|"), "iu")
    : null;

  return {
    isEmpty: compiled.length === 0,

    test(text) {
      if (!combined) return false;
      return combined.test(normalize(text));
    },

    match(text, now) {
      if (compiled.length === 0) return null;
      const normalized = normalize(text);
      for (const c of compiled) {
        if (c.expiresAt != null && c.expiresAt < now) continue; // expiry (6.1)
        // Find which include term matched, reported as the user entered it
        // (not the matched surface form, design 3.6).
        let hitTerm = null;
        for (const t of c.terms) {
          if (t.re.test(normalized)) {
            hitTerm = t.term;
            break;
          }
        }
        if (!hitTerm) continue;
        if (c.exclude && c.exclude.test(normalized)) continue; // excludeTerms veto
        return { profileId: c.id, term: hitTerm };
      }
      return null;
    },
  };
}
