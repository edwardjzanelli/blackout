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
import { normalize } from "../content/matcher.js";
import starterConfig from "../config/starter-profiles.json" with { type: "json" };

const DEBUG = false;

/** Bump when the persisted shape changes; migrations branch on this (7a). */
export const SCHEMA_VERSION = 3;

const PROFILE_PREFIX = "profile:";
const PREFERENCES_KEY = "preferences";
const SCHEMA_KEY = "schemaVersion";
/** Sync: ids of deleted starter profiles, so seeding never revives them. */
const TOMBSTONE_KEY = "tombstones";

/** Local (per-device) keys: pause state and counters stay out of sync (6.3). */
const PAUSED_KEY = "devicePaused";
const PAUSED_SITES_KEY = "pausedSites";
const COUNTERS_KEY = "counters";

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

/** @param {string} s @returns {number} 32-bit FNV-1a hash */
function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Normalization key for a term: case-insensitive, whitespace-collapsed. */
function normKey(term) {
  return normalize(term).toLowerCase();
}

/** A stable id derived from the normalized term (design 3.2 one-box model). */
export function termId(term) {
  return `filter-${fnv(normKey(term)).toString(16)}`;
}

/**
 * De-duplicate terms case-insensitively, keeping the first spelling and order.
 * @param {string[]} terms
 * @returns {string[]}
 */
export function dedupeTerms(terms) {
  const seen = new Set();
  const out = [];
  for (const raw of terms) {
    const term = (raw || "").trim();
    const key = normKey(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * One single-term filter (design 3.2a). The other data-model fields stay
 * present but unused, so nothing has to migrate later (design 7).
 * @param {string} term the include term exactly as typed (trimmed)
 * @param {FilterProfile} [existing]
 * @returns {FilterProfile}
 */
function makeTermProfile(term, existing) {
  const now = Date.now();
  return {
    id: termId(term),
    name: term,
    enabled: true,
    includeTerms: [term],
    excludeTerms: [],
    matchMode: "phrase",
    expiresAt: null,
    siteScope: [],
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now,
  };
}

/** The starter terms (from config) and their ids. */
function starterTerms() {
  return dedupeTerms(starterConfig.flatMap((entry) => entry.includeTerms || []));
}
function starterTermIds() {
  return new Set(starterTerms().map(termId));
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
      const relevant =
        key.startsWith(PROFILE_PREFIX) || key === PREFERENCES_KEY || key === SCHEMA_KEY || key === TOMBSTONE_KEY;
      if (relevant && all[key] === undefined) all[key] = value;
    }
  }

  let profiles = profilesFrom(all);
  let preferences = all[PREFERENCES_KEY];
  let schemaVersion = all[SCHEMA_KEY];
  const toWrite = {};
  let seeded = false;

  // Seed one single-term filter per starter term (design 3.2a), only when no
  // profiles exist, with a stable term-derived id (idempotent across devices)
  // and never one the user deleted (tombstoned).
  if (profiles.length === 0) {
    const tombstones = Array.isArray(all[TOMBSTONE_KEY]) ? all[TOMBSTONE_KEY] : [];
    for (const term of starterTerms()) {
      const profile = makeTermProfile(term);
      if (tombstones.includes(profile.id)) continue;
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

/** The area we write profiles/preferences to: sync if available, else local. */
function primaryArea() {
  return syncArea() || browser.storage.local;
}

/**
 * Create or update a profile (one sync item). Stamps updatedAt.
 * @param {FilterProfile} profile
 */
export async function saveProfile(profile) {
  profile.updatedAt = Date.now();
  await writeItems(primaryArea(), { [PROFILE_PREFIX + profile.id]: profile });
}

/** @param {Preferences} preferences */
export async function savePreferences(preferences) {
  await writeItems(primaryArea(), { [PREFERENCES_KEY]: preferences });
}

/** Whether an id belongs to a shipped starter term. */
function isStarterId(id) {
  return starterTermIds().has(id);
}

/**
 * Reconcile the whole filter set to exactly these terms (design 3.2 one-box
 * model). Lines are de-duplicated case-insensitively keeping the first spelling;
 * each surviving term is a single-term filter with a stable id. Filters no
 * longer listed are removed, tombstoning any starter term so it never returns.
 * One sync item per filter, so the list is chunked across items and is never a
 * single oversized blob.
 * @param {string[]} terms raw lines as typed
 */
export async function saveTermList(terms) {
  const desired = new Map(); // id -> term (as typed)
  for (const term of dedupeTerms(terms)) desired.set(termId(term), term);

  const { profiles } = await loadState();
  const existingById = new Map(profiles.map((p) => [p.id, p]));

  for (const profile of profiles) {
    if (!desired.has(profile.id)) await deleteProfile(profile.id);
  }
  for (const [id, term] of desired) {
    if (existingById.has(id)) continue; // unchanged term keeps its filter
    await saveProfile(makeTermProfile(term));
  }
}

/**
 * Delete a profile. Deleting a starter records a tombstone (its fixed id) in
 * sync so seeding never revives it on any device.
 * @param {string} id
 */
export async function deleteProfile(id) {
  const sync = syncArea();
  const key = PROFILE_PREFIX + id;
  if (sync) {
    try {
      await sync.remove(key);
    } catch {
      // ignore; also remove from local below
    }
  }
  await browser.storage.local.remove(key);

  if (isStarterId(id)) {
    const area = primaryArea();
    let tombstones = [];
    try {
      const got = await area.get(TOMBSTONE_KEY);
      tombstones = Array.isArray(got[TOMBSTONE_KEY]) ? got[TOMBSTONE_KEY] : [];
    } catch {
      // fall through with empty list
    }
    if (!tombstones.includes(id)) {
      await writeItems(area, { [TOMBSTONE_KEY]: [...tombstones, id] });
    }
  }
}

/**
 * @typedef {Object} Counters
 * @property {string} todayDate YYYY-MM-DD (local)
 * @property {number} todayCount distinct stories blocked today
 * @property {number} totalCount distinct stories blocked all time
 */

/** @param {any} c @returns {Counters} */
function normalizeCounters(c) {
  return {
    todayDate: (c && typeof c.todayDate === "string" && c.todayDate) || "",
    todayCount: (c && Number(c.todayCount)) || 0,
    totalCount: (c && Number(c.totalCount)) || 0,
  };
}

/**
 * @typedef {Object} DeviceState
 * @property {boolean} paused global pause (this device)
 * @property {string[]} pausedSites hostnames paused on this device
 * @property {Counters} counters this device's blocked counts
 */

/** Read per-device state from local storage. @returns {Promise<DeviceState>} */
export async function loadDeviceState() {
  const d = await browser.storage.local.get([PAUSED_KEY, PAUSED_SITES_KEY, COUNTERS_KEY]);
  return {
    paused: d[PAUSED_KEY] === true,
    pausedSites: Array.isArray(d[PAUSED_SITES_KEY]) ? d[PAUSED_SITES_KEY] : [],
    counters: normalizeCounters(d[COUNTERS_KEY]),
  };
}

/** @param {boolean} paused */
export async function setPaused(paused) {
  await browser.storage.local.set({ [PAUSED_KEY]: paused === true });
}

/** @param {string} hostname @param {boolean} paused */
export async function setSitePaused(hostname, paused) {
  const { pausedSites } = await loadDeviceState();
  const set = new Set(pausedSites);
  if (paused) set.add(hostname);
  else set.delete(hostname);
  await browser.storage.local.set({ [PAUSED_SITES_KEY]: [...set] });
}

/**
 * Add to the per-device blocked counters, rolling the day over at `today`.
 * @param {string} today YYYY-MM-DD (local, supplied by the caller)
 * @param {number} [n]
 * @returns {Promise<Counters>}
 */
export async function bumpCounter(today, n = 1) {
  const { counters } = await loadDeviceState();
  const next =
    counters.todayDate === today
      ? { ...counters }
      : { todayDate: today, todayCount: 0, totalCount: counters.totalCount };
  next.todayCount += n;
  next.totalCount += n;
  await browser.storage.local.set({ [COUNTERS_KEY]: next });
  return next;
}

/**
 * Is masking paused for this hostname? True if globally paused or the site is
 * in the per-device paused list (exact host or a parent domain).
 * @param {DeviceState} device
 * @param {string} hostname
 * @returns {boolean}
 */
export function isPaused(device, hostname) {
  if (device.paused) return true;
  return (device.pausedSites || []).some((d) => hostname === d || hostname.endsWith("." + d));
}

/**
 * Invoke callback when this device's pause state changes (not counters), so the
 * content script can re-evaluate (design 3.1, FR-09).
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export function onDeviceStateChanged(callback) {
  const listener = (changes, area) => {
    if (area !== "local") return;
    if (changes[PAUSED_KEY] || changes[PAUSED_SITES_KEY]) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
