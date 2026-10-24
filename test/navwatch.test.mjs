// In-page navigation watch (design 5.3a, 5.4). SPAs change the URL with the
// history API without a document load; the watcher must notice so rule 1 can be
// re-evaluated (the Facebook search-cover bug). Red before navwatch.js existed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { watchNavigation, POLL_MS } from "../src/content/navwatch.js";

/** A minimal Window stub that records listeners, timers and (optionally) the
 * Navigation API, and lets a test fire each. */
function fakeWin({ withNav = false } = {}) {
  const listeners = {};
  const intervals = [];
  const win = {
    location: { href: "https://site.test/home" },
    addEventListener: (t, fn) => (listeners[t] = listeners[t] || []).push(fn),
    removeEventListener: (t, fn) => (listeners[t] = (listeners[t] || []).filter((f) => f !== fn)),
    setInterval: (fn, ms) => intervals.push({ fn, ms }) && intervals.length,
    clearInterval: (id) => (intervals[id - 1] = null),
    __listeners: listeners,
    __intervals: intervals,
    fire: (t) => (listeners[t] || []).slice().forEach((fn) => fn()),
  };
  if (withNav) {
    const navL = {};
    win.navigation = {
      addEventListener: (t, fn) => (navL[t] = navL[t] || []).push(fn),
      removeEventListener: (t, fn) => (navL[t] = (navL[t] || []).filter((f) => f !== fn)),
    };
    win.fireNav = (t) => (navL[t] || []).slice().forEach((fn) => fn());
  }
  return win;
}

test("Navigation API: currententrychange after a pushState-style URL change fires onChange", () => {
  const win = fakeWin({ withNav: true });
  const seen = [];
  watchNavigation(win, (href) => seen.push(href));

  assert.equal(win.__intervals.length, 0, "no polling when the Navigation API is present");
  win.location.href = "https://site.test/search?q=mirelle";
  win.fireNav("currententrychange");
  assert.deepEqual(seen, ["https://site.test/search?q=mirelle"]);
});

test("without the Navigation API, polling every 500 ms catches the URL change", () => {
  const win = fakeWin({ withNav: false });
  const seen = [];
  watchNavigation(win, (href) => seen.push(href));

  assert.equal(win.__intervals.length, 1, "one poll timer");
  assert.equal(win.__intervals[0].ms, POLL_MS, "polls no more often than every 500 ms");

  const poll = win.__intervals[0].fn;
  poll(); // no change yet
  assert.deepEqual(seen, []);
  win.location.href = "https://site.test/search?q=mirelle";
  poll();
  assert.deepEqual(seen, ["https://site.test/search?q=mirelle"]);
});

test("popstate fires onChange only on a real href change", () => {
  const win = fakeWin({ withNav: true });
  const seen = [];
  watchNavigation(win, (href) => seen.push(href));

  win.fire("popstate"); // href unchanged
  assert.deepEqual(seen, [], "no callback when the URL did not change");
  win.location.href = "https://site.test/other";
  win.fire("popstate");
  assert.deepEqual(seen, ["https://site.test/other"]);
});

test("cleanup removes listeners and the poll timer", () => {
  const win = fakeWin({ withNav: false });
  const seen = [];
  const stop = watchNavigation(win, (href) => seen.push(href));
  stop();

  assert.equal(win.__intervals[0], null, "interval cleared");
  win.location.href = "https://site.test/after-cleanup";
  win.fire("popstate");
  win.fire("hashchange");
  assert.deepEqual(seen, [], "no callbacks after cleanup");
});
