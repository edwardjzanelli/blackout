// Toolbar popup (design 3.1, FR-09, FR-12, 13): global On/Pause and per-site
// pause (per device, storage.local), blocked-on-this-page from the active tab's
// content script, today and all-time counts, and a "Watched it" button for any
// enabled filter with an expiry. No term literals; keyboard operable.

import { loadDeviceState, setPaused, setSitePaused } from "../shared/storage.js";

const api = globalThis.browser ?? globalThis.chrome;

async function activeTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

function hostnameOf(tab) {
  try {
    return new URL(tab.url).hostname;
  } catch {
    return "";
  }
}

/** Ask the tab's content script for its blocked count; null if none answers. */
function pageCount(tabId) {
  return new Promise((resolve) => {
    try {
      api.tabs.sendMessage(tabId, { type: "blackout:count" }, (resp) => {
        if (api.runtime.lastError || !resp) resolve(null);
        else resolve(resp.count);
      });
    } catch {
      resolve(null);
    }
  });
}

function init() {
  const onSwitch = document.getElementById("on-switch");
  const siteSwitch = document.getElementById("site-switch");
  const siteName = document.getElementById("site-name");
  const pageLine = document.getElementById("page-count");
  const todayEl = document.getElementById("count-today");
  const totalEl = document.getElementById("count-total");

  async function refresh() {
    const device = await loadDeviceState();
    onSwitch.checked = !device.paused; // the switch reads "On"
    todayEl.textContent = String(device.counters.todayCount);
    totalEl.textContent = String(device.counters.totalCount);

    const tab = await activeTab();
    const host = tab ? hostnameOf(tab) : "";
    siteName.textContent = host || "this site";
    siteSwitch.checked = device.pausedSites.includes(host);
    siteSwitch.disabled = !host;

    if (tab && host) {
      const count = await pageCount(tab.id);
      pageLine.textContent = count == null ? "Not available on this page" : `Blocked on this page: ${count}`;
    } else {
      pageLine.textContent = "Not available on this page";
    }
  }

  onSwitch.addEventListener("change", async () => {
    await setPaused(!onSwitch.checked);
    refresh();
  });
  siteSwitch.addEventListener("change", async () => {
    const tab = await activeTab();
    const host = tab ? hostnameOf(tab) : "";
    if (host) await setSitePaused(host, siteSwitch.checked);
    refresh();
  });
  document.getElementById("open-settings").addEventListener("click", () => api.runtime.openOptionsPage());

  // Re-read the active tab and counts whenever the popup is shown/focused.
  window.addEventListener("focus", () => refresh());
  refresh();
}

if (typeof document !== "undefined" && document.getElementById("blackout-popup")) {
  init();
}
