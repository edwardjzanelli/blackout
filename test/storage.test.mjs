// Storage layer (design 2, 6, 6.3): profiles and preferences live in
// storage.sync, one item per profile, seeded idempotently from the config, with
// a one-time local-to-sync migration and a local fallback on quota/unavailable.

import { test } from "node:test";
import assert from "node:assert/strict";
import starters from "../src/config/starter-profiles.json" with { type: "json" };

/** A fake chrome.storage with sync + local areas and onChanged, resettable. */
function makeChrome() {
  const listeners = [];
  const onChanged = {
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch: (changes, area) => listeners.slice().forEach((fn) => fn(changes, area)),
    listeners,
  };
  function area(name) {
    const data = new Map();
    return {
      name,
      data,
      fail: false,
      async get(keys) {
        if (keys == null) return Object.fromEntries(data);
        const ks = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of ks) if (data.has(k)) out[k] = data.get(k);
        return out;
      },
      async set(items) {
        if (this.fail) throw new Error("QUOTA_BYTES quota exceeded");
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: data.get(k), newValue: v };
          data.set(k, v);
        }
        onChanged.dispatch(changes, name);
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
      },
    };
  }
  return { storage: { sync: area("sync"), local: area("local"), onChanged } };
}

const chrome = makeChrome();
globalThis.chrome = chrome;
const storage = await import("../src/shared/storage.js");

function reset() {
  chrome.storage.sync.data.clear();
  chrome.storage.local.data.clear();
  chrome.storage.sync.fail = false;
  chrome.storage.local.fail = false;
  chrome.storage.onChanged.listeners.length = 0;
}

const PROFILE = (id) => `profile:${id}`;
const starterId = starters[0].id;
const profileItems = (area) => [...area.data.keys()].filter((k) => k.startsWith("profile:"));

test("seeds the starter profile once from the config into sync", async () => {
  reset();
  const state = await storage.loadState();
  assert.equal(state.seeded, true);
  assert.equal(state.profiles.length, starters.length);
  assert.ok(chrome.storage.sync.data.has(PROFILE(starterId)), "one item per profile in sync");
  // The profile name is the first include term as entered, not an invented name.
  assert.equal(state.profiles[0].name, starters[0].includeTerms[0]);
});

test("seeding is idempotent when sync already holds the starter id", async () => {
  reset();
  // A device already synced an edited starter under the same fixed id.
  const edited = { id: starterId, name: "x", enabled: true, includeTerms: ["Only one"], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [], createdAt: 1, updatedAt: 1 };
  chrome.storage.sync.data.set(PROFILE(starterId), edited);

  const state = await storage.loadState();
  assert.equal(state.seeded, false, "did not re-seed");
  assert.equal(profileItems(chrome.storage.sync).length, 1, "no duplicate profile item");
  assert.deepEqual(state.profiles[0].includeTerms, ["Only one"], "kept the edited profile");
});

test("migrates legacy local profiles and preferences into sync once", async () => {
  reset();
  const legacy = { id: "legacy-1", name: "L", enabled: true, includeTerms: ["Spoilers"], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [], createdAt: 0, updatedAt: 0 };
  chrome.storage.local.data.set("schemaVersion", 2);
  chrome.storage.local.data.set("profiles", [legacy]);
  chrome.storage.local.data.set("preferences", { globalEnabled: true });

  const state = await storage.loadState();
  assert.ok(chrome.storage.sync.data.has(PROFILE("legacy-1")), "legacy profile moved to sync");
  assert.equal(state.profiles.some((p) => p.id === "legacy-1"), true);
  assert.equal(chrome.storage.local.data.has("profiles"), false, "legacy local blob removed");

  // Second load must not migrate again (sync now owns the schema).
  const before = profileItems(chrome.storage.sync).length;
  await storage.loadState();
  assert.equal(profileItems(chrome.storage.sync).length, before, "migration ran once");
});

test("falls back to local on a sync quota error without losing the profile", async () => {
  reset();
  chrome.storage.sync.fail = true; // every sync.set throws

  const state = await storage.loadState();
  assert.equal(state.profiles.length, starters.length, "profile still returned");
  assert.ok(chrome.storage.local.data.has(PROFILE(starterId)), "profile persisted to local");

  // A reload still finds it (not lost) and does not duplicate it.
  const again = await storage.loadState();
  assert.equal(again.profiles.filter((p) => p.id === starterId).length, 1);
});

test("an onChanged event in the sync area triggers re-evaluation", async () => {
  reset();
  let calls = 0;
  const off = storage.onStateChanged(() => calls++);

  chrome.storage.onChanged.dispatch({ [PROFILE("x")]: { newValue: {} } }, "sync");
  assert.equal(calls, 1, "profile change in sync re-evaluates");

  chrome.storage.onChanged.dispatch({ somethingElse: { newValue: 1 } }, "sync");
  assert.equal(calls, 1, "unrelated key ignored");

  off();
  chrome.storage.onChanged.dispatch({ [PROFILE("x")]: { newValue: {} } }, "sync");
  assert.equal(calls, 1, "unsubscribed");
});
