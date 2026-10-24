// Storage layer: profiles and preferences in storage.local under a
// schemaVersion key (design 7, 7a). No background script, so the starter
// profile (design 3.5) is seeded lazily the first time a content script reads
// storage and finds none.

import { browser } from "./browser.js";

/** Bump when the persisted shape changes; migrations branch on this (7a). */
export const SCHEMA_VERSION = 2;

/**
 * @typedef {Object} FilterProfile
 * @property {string} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {string[]} includeTerms
 * @property {string[]} excludeTerms
 * @property {"phrase"} matchMode
 * @property {number|null} expiresAt epoch ms, or null for no expiry
 * @property {string[]} siteScope
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Preferences
 * @property {boolean} globalEnabled
 * @property {"blackout"} defaultAction
 * @property {boolean} allowReveal
 * @property {string[]} siteAllowlist
 * @property {number} historyRetentionDays
 * @property {boolean} snarkyLabels
 * @property {number} pageCoverRatio fraction of stories that must match (3.6)
 * @property {number} pageCoverMinMatches minimum matching stories (3.6)
 */

/**
 * @typedef {Object} BlackoutState
 * @property {number} schemaVersion
 * @property {FilterProfile[]} profiles
 * @property {Preferences} preferences
 * @property {boolean} seeded whether defaults were written on this read
 */

/** @returns {Preferences} */
function defaultPreferences() {
  return {
    globalEnabled: true,
    defaultAction: "blackout",
    allowReveal: true,
    siteAllowlist: [],
    historyRetentionDays: 30,
    snarkyLabels: false,
    pageCoverRatio: 0.5,
    pageCoverMinMatches: 6,
  };
}

/**
 * Bring stored preferences up to the current schema, adding keys introduced
 * since they were written. Returns true if anything changed.
 * @param {Preferences} preferences
 * @param {number} fromVersion
 * @returns {boolean}
 */
function migratePreferences(preferences, fromVersion) {
  let changed = false;
  if (fromVersion < 2) {
    if (typeof preferences.pageCoverRatio !== "number") {
      preferences.pageCoverRatio = 0.5;
      changed = true;
    }
    if (typeof preferences.pageCoverMinMatches !== "number") {
      preferences.pageCoverMinMatches = 6;
      changed = true;
    }
  }
  return changed;
}

/**
 * The one starter profile shipped on first run (design 3.5).
 * @param {number} now
 * @returns {FilterProfile}
 */
function starterProfile(now) {
  return {
    id: globalThis.crypto.randomUUID(),
    name: "Kardashians",
    enabled: true,
    includeTerms: ["Kardashian", "Kris Jenner", "Kylie Jenner", "Kendall Jenner"],
    excludeTerms: [],
    matchMode: "phrase",
    expiresAt: null,
    siteScope: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Read profiles and preferences, seeding defaults the first time (lazy, because
 * there is no background context to run an installer).
 * @returns {Promise<BlackoutState>}
 */
export async function loadState() {
  const stored = await browser.storage.local.get([
    "schemaVersion",
    "profiles",
    "preferences",
  ]);

  let { schemaVersion, profiles, preferences } = stored;
  const toWrite = {};
  let seeded = false;

  if (!Array.isArray(profiles) || profiles.length === 0) {
    profiles = [starterProfile(Date.now())];
    toWrite.profiles = profiles;
    seeded = true;
  }
  if (!preferences || typeof preferences !== "object") {
    preferences = defaultPreferences();
    toWrite.preferences = preferences;
  } else if (migratePreferences(preferences, typeof schemaVersion === "number" ? schemaVersion : 0)) {
    toWrite.preferences = preferences;
  }
  if (schemaVersion !== SCHEMA_VERSION) {
    schemaVersion = SCHEMA_VERSION;
    toWrite.schemaVersion = schemaVersion;
  }

  if (Object.keys(toWrite).length > 0) {
    await browser.storage.local.set(toWrite);
  }

  return { schemaVersion, profiles, preferences, seeded };
}

/**
 * Invoke callback whenever profiles or preferences change in local storage, so
 * the page can be re-evaluated (design 5.3).
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export function onStateChanged(callback) {
  const listener = (changes, area) => {
    if (area !== "local") return;
    if (changes.profiles || changes.preferences || changes.schemaVersion) {
      callback();
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
