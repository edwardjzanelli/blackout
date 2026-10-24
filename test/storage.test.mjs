// Storage layer (design 2, 3.2, 6, 6.3): one single-term filter per line, each
// a sync item with a stable term-derived id; idempotent per-term seeding, a
// local-to-sync migration, quota fallback, tombstones on removal, and per-device
// pause and counters.

import { test } from "node:test";
import assert from "node:assert/strict";
import starters from "../src/config/starter-profiles.json" with { type: "json" };

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
const profileItems = (a) => [...a.data.keys()].filter((k) => k.startsWith("profile:"));
const starterTerms = storage.dedupeTerms(starters.flatMap((s) => s.includeTerms || []));

test("seeds one single-term filter per starter term", async () => {
  reset();
  const state = await storage.loadState();
  assert.equal(state.seeded, true);
  assert.equal(state.profiles.length, starterTerms.length);
  for (const term of starterTerms) {
    const id = storage.termId(term);
    assert.ok(chrome.storage.sync.data.has(PROFILE(id)), `item for ${term}`);
    const p = chrome.storage.sync.data.get(PROFILE(id));
    assert.deepEqual(p.includeTerms, [term]);
    assert.equal(p.name, term);
  }
});

test("seeding is idempotent: no reseed once profiles exist", async () => {
  reset();
  await storage.saveTermList(["Zeta"]); // user-defined single filter
  const state = await storage.loadState();
  assert.equal(state.seeded, false);
  assert.equal(profileItems(chrome.storage.sync).length, 1, "no duplicate or starter reseed");
});

test("saveTermList de-duplicates case-insensitively, keeping the first spelling", async () => {
  reset();
  await storage.saveTermList(["Zeta", "zeta", "  Alpha  ", "", "ALPHA"]);
  const { profiles } = await storage.loadState();
  const terms = profiles.map((p) => p.includeTerms[0]).sort();
  assert.deepEqual(terms, ["Alpha", "Zeta"]);
});

test("the list is chunked across items (never one oversized blob, under 8 KB each)", async () => {
  reset();
  const many = Array.from({ length: 60 }, (_, i) => `term-number-${i}`);
  await storage.saveTermList(many);
  const items = profileItems(chrome.storage.sync);
  assert.equal(items.length, 60, "one sync item per filter");
  for (const key of items) {
    const bytes = Buffer.byteLength(JSON.stringify(chrome.storage.sync.data.get(key)), "utf8");
    assert.ok(bytes < 8192, `${key} is ${bytes} bytes, under the 8 KB item limit`);
  }
  assert.equal(chrome.storage.sync.data.has("terms"), false, "no single list blob");
});

test("removing a starter term tombstones it so seeding never revives it", async () => {
  reset();
  await storage.loadState(); // seed all starter terms
  const removed = starterTerms[0];
  await storage.saveTermList(starterTerms.slice(1)); // box without the first term

  const id = storage.termId(removed);
  assert.equal(chrome.storage.sync.data.has(PROFILE(id)), false, "removed starter gone");
  assert.deepEqual(chrome.storage.sync.data.get("tombstones"), [id], "tombstone recorded");

  const again = await storage.loadState();
  assert.equal(again.profiles.some((p) => p.id === id), false, "stays gone");
});

test("removing a user term does not tombstone it", async () => {
  reset();
  await storage.loadState(); // seed starters
  // The box always holds the full list: starters kept, two user terms added.
  await storage.saveTermList([...starterTerms, "Zeta", "Alpha"]);
  assert.equal(chrome.storage.sync.data.has("tombstones"), false, "nothing removed yet");
  await storage.saveTermList([...starterTerms, "Zeta"]); // drop only the user term Alpha
  assert.equal(chrome.storage.sync.data.has("tombstones"), false, "no tombstone for a user term");
});

test("migrates legacy local profiles and preferences into sync once", async () => {
  reset();
  const legacy = { id: "legacy-1", name: "L", enabled: true, includeTerms: ["Spoilers"], excludeTerms: [], matchMode: "phrase", expiresAt: null, siteScope: [], createdAt: 0, updatedAt: 0 };
  chrome.storage.local.data.set("schemaVersion", 2);
  chrome.storage.local.data.set("profiles", [legacy]);
  chrome.storage.local.data.set("preferences", { globalEnabled: true });

  const state = await storage.loadState();
  assert.ok(chrome.storage.sync.data.has(PROFILE("legacy-1")));
  assert.ok(state.profiles.some((p) => p.id === "legacy-1"));
  assert.equal(chrome.storage.local.data.has("profiles"), false, "legacy local blob removed");

  const before = profileItems(chrome.storage.sync).length;
  await storage.loadState();
  assert.equal(profileItems(chrome.storage.sync).length, before, "migration ran once");
});

test("falls back to local on a sync quota error without losing filters", async () => {
  reset();
  chrome.storage.sync.fail = true;
  const state = await storage.loadState();
  assert.equal(state.profiles.length, starterTerms.length, "still returned");
  assert.ok(chrome.storage.local.data.has(PROFILE(storage.termId(starterTerms[0]))), "persisted to local");
});

test("onStateChanged fires for a sync profile change", async () => {
  reset();
  let calls = 0;
  const off = storage.onStateChanged(() => calls++);
  chrome.storage.onChanged.dispatch({ [PROFILE("x")]: { newValue: {} } }, "sync");
  assert.equal(calls, 1);
  chrome.storage.onChanged.dispatch({ somethingElse: { newValue: 1 } }, "sync");
  assert.equal(calls, 1);
  off();
});

test("global and per-site pause (local) via isPaused", async () => {
  reset();
  let d = await storage.loadDeviceState();
  assert.equal(storage.isPaused(d, "news.example.com"), false);

  await storage.setPaused(true);
  d = await storage.loadDeviceState();
  assert.equal(storage.isPaused(d, "news.example.com"), true);

  await storage.setPaused(false);
  await storage.setSitePaused("example.com", true);
  d = await storage.loadDeviceState();
  assert.equal(storage.isPaused(d, "news.example.com"), true, "subdomain of a paused site");
  assert.equal(storage.isPaused(d, "other.com"), false);
  await storage.setSitePaused("example.com", false);
  d = await storage.loadDeviceState();
  assert.equal(storage.isPaused(d, "news.example.com"), false);
});

test("bumpCounter accumulates and rolls the day over", async () => {
  reset();
  assert.deepEqual(await storage.bumpCounter("2030-01-01", 1), { todayDate: "2030-01-01", todayCount: 1, totalCount: 1 });
  assert.deepEqual(await storage.bumpCounter("2030-01-01", 1), { todayDate: "2030-01-01", todayCount: 2, totalCount: 2 });
  assert.deepEqual(await storage.bumpCounter("2030-01-02", 1), { todayDate: "2030-01-02", todayCount: 1, totalCount: 3 });
});

test("counters count distinct stories, a whole-page cover as one (FR-12)", async () => {
  reset();
  const today = "2030-02-01";
  const active = new Set();
  // main bumps once per newly masked card; a reprocessed card does not bump.
  for (const card of ["a", "b", "c", "a"]) {
    if (active.has(card)) continue;
    active.add(card);
    await storage.bumpCounter(today, 1);
  }
  // a whole-page cover is a single blocked story regardless of how many it hides
  await storage.bumpCounter(today, 1);
  const { counters } = await storage.loadDeviceState();
  assert.equal(counters.todayCount, 4, "3 distinct cards + 1 cover, not once per scan");
  assert.equal(counters.totalCount, 4);
});
