// Site-adapter registry (design 5.4). Each adapter is a small data file of
// selectors and container rules, so adding a site is a data change, not an
// engine change. The container resolver treats an adapter's unit selectors as
// additional safe content-unit boundaries for that host.

import youtube from "./youtube.js";
import facebook from "./facebook.js";
import instagram from "./instagram.js";

/**
 * @typedef {Object} Adapter
 * @property {string[]} hosts registrable domains this adapter applies to
 * @property {string[]} unitSelectors CSS selectors for this site's content units
 */

/** @type {Adapter[]} */
const ADAPTERS = [youtube, facebook, instagram];

/**
 * The adapter whose hosts match this hostname (exact or a subdomain), or null.
 * @param {string} [hostname]
 * @returns {Adapter|null}
 */
export function pickAdapter(hostname = "") {
  const host = (hostname || "").toLowerCase();
  return (
    ADAPTERS.find((a) => a.hosts.some((h) => host === h || host.endsWith("." + h))) || null
  );
}

/**
 * The adapter's unit selectors joined for `Element.matches`, or "" if none.
 * @param {string} [hostname]
 * @returns {string}
 */
export function unitSelectorFor(hostname) {
  const adapter = pickAdapter(hostname);
  return adapter ? adapter.unitSelectors.join(", ") : "";
}
