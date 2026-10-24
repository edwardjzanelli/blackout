// Storage layer. Profiles and preferences are user data kept in the browser's
// own sync storage (storage.sync), one item per profile plus one for
// preferences, so they follow the user across devices signed in to the same
// browser (design 2, 6, 6.3). Starter defaults come from
// src/config/starter-profiles.json and seed sync once, idempotently (fixed ids,
// never seeding an id already present). On a quota error or if sync is
// unavailable we fall back to storage.local and never lose a profile. Revealed
// state, counters and other per-device state stay out of sync (see revealed.js
// and page memory).

import { browser } from "./browser.js";
import starterConfig from "../config/starter-profiles.json" with { type: "json" };

const DEBUG = false;

/** Bump when the persisted shape changes; migrations branch on this (7a). */
export const SCHEMA_VERSION = 3;

const PROFILE_PREFIX = "profile:";
const PREFERENCES_KEY = "preferences";
const SCHEMA_KEY = "schemaVersion";

/**
 * @typedef {Object} FilterProfile
 * @property {string} id
 * @property {string} name first include term as entered (not an invented name)
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

/** @param {...unknown} args */
function log(...args) {
  if (DEBUG) console.log("[blackout]", ...args);
}

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
 * Add preference keys introduced since the stored data was written.
 * @param {Preferences} preferences
 * @param {number} fromVersion
 * @returns {boolean} whether anything changed
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
 * Materialize a config entry into a full profile. The profile name is the first
 * include term exactly as entered; the term itself lives only in the config.
 * @param {object} entry
 * @returns {FilterProfile}
 */
function materialize(entry) {
  const includeTerms = entry.includeTerms || [];
  const now = Date.now();
  return {
    id: entry.id,
    name: includeTerms[0] || "",
    enabled: entry.enabled !== false,
    includeTerms,
    excludeTerms: entry.excludeTerms || [],
    matchMode: entry.matchMode || "phrase",
    expiresAt: entry.expiresAt ?? null,
    siteScope: entry.siteScope || [],
    createdAt: now,
    updatedAt: now,
  };
}

/** @param {Record<string, unknown>} all @returns {FilterProfile[]} */
function profilesFrom(all) {
  const out = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PROFILE_PREFIX)) out.push(/** @type {FilterProfile} */ (value));
  }
  return out;
}

/** The sync area, or null if the browser does not expose it. */
function syncArea() {
  return browser.storage && browser.storage.sync ? browser.storage.sync : null;
}

/**
 * Write items to the preferred area; on a quota error or failure, fall back to
 * local so a profile is never lost (design 2 addendum).
 * @param {object} preferred
 * @param {object} items
 */
async function writeItems(preferred, items) {
  try {
    await preferred.set(items);
  } catch (err) {
    log("storage write failed; falling back to local:", err && err.message);
    await browser.storage.local.set(items);
  }
}

/**
 * Read profiles and preferences from sync (local as fallback), seeding and
 * migrating as needed. Idempotent across devices: fixed ids mean a profile
 * written by another device shares the same key, so it is never duplicated.
 * @returns {Promise<BlackoutState>}
 */
export async function loadState() {
  const sync = syncArea();
  const local = browser.storage.local;

  let syncOk = sync != null;
  let syncData = {};
  if (syncOk) {
    try {
      syncData = await sync.get(null);
    } catch (err) {
      log("storage.sync unavailable; using local:", err && err.message);
      syncOk = false;
    }
  }
  const localData = await local.get(null);
  const primary = syncOk ? sync : local;

  /** @type {Record<string, any>} */
  const all = syncOk ? { ...syncData } : { ...localData };

  // One-time migration of the legacy local blob layout (v<3:
  // {schemaVersion, profiles:[...], preferences}) into the per-item layout.
  if (all[SCHEMA_KEY] === undefined && Array.isArray(localData.profiles) && localData.profiles.length) {
    const migrated = {};
    for (const profile of localData.profiles) migrated[PROFILE_PREFIX + profile.id] = profile;
    if (localData.preferences) migrated[PREFERENCES_KEY] = localData.preferences;
    migrated[SCHEMA_KEY] = typeof localData.schemaVersion === "number" ? localData.schemaVersion : 1;
    await writeItems(primary, migrated);
    await local.remove(["profiles", "preferences", SCHEMA_KEY]); // stop reading legacy local
    Object.assign(all, migrated);
  }

  // Include any items the fallback wrote to local, so nothing is lost when sync
  // is the primary area but a write landed in local.
  if (syncOk) {
    for (const [key, value] of Object.entries(localData)) {
      const relevant = key.startsWith(PROFILE_PREFIX) || key === PREFERENCES_KEY || key === SCHEMA_KEY;
      if (relevant && all[key] === undefined) all[key] = value;
    }
  }

  let profiles = profilesFrom(all);
  let preferences = all[PREFERENCES_KEY];
  let schemaVersion = all[SCHEMA_KEY];
  const toWrite = {};
  let seeded = false;

  // Seed starters only when no profiles exist, and never an id already present
  // (idempotent). Fixed ids mean a second device cannot create a duplicate.
  if (profiles.length === 0) {
    const present = new Set(profiles.map((p) => p.id));
    for (const entry of starterConfig) {
      if (present.has(entry.id)) continue;
      const profile = materialize(entry);
      toWrite[PROFILE_PREFIX + profile.id] = profile;
      profiles.push(profile);
      seeded = true;
    }
  }

  if (!preferences || typeof preferences !== "object") {
    preferences = defaultPreferences();
    toWrite[PREFERENCES_KEY] = preferences;
  } else if (migratePreferences(preferences, typeof schemaVersion === "number" ? schemaVersion : 0)) {
    toWrite[PREFERENCES_KEY] = preferences;
  }
  if (schemaVersion !== SCHEMA_VERSION) {
    schemaVersion = SCHEMA_VERSION;
    toWrite[SCHEMA_KEY] = schemaVersion;
  }

  if (Object.keys(toWrite).length > 0) await writeItems(primary, toWrite);

  return { schemaVersion, profiles, preferences, seeded };
}

/**
 * Invoke callback whenever a profile, preferences or the schema changes in sync
 * (or the local fallback), so an edit on one device re-evaluates open pages on
 * another (design 5.3, 6.3).
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export function onStateChanged(callback) {
  const listener = (changes, area) => {
    if (area !== "sync" && area !== "local") return;
    for (const key of Object.keys(changes)) {
      if (key.startsWith(PROFILE_PREFIX) || key === PREFERENCES_KEY || key === SCHEMA_KEY) {
        callback();
        return;
      }
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
