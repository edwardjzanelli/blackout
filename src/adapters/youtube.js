// YouTube adapter (design 5.4). Data only: the custom-element names that mark a
// video/short/channel tile across home, search results, and the watch-page
// sidebar, plus the Shorts shelf. YouTube's titles live in the light DOM, so a
// match inside a tile is reachable. Custom element names are stable public API;
// class names are not, so we never anchor on them.

/** @type {import("./index.js").Adapter} */
export default {
  hosts: ["youtube.com"],
  unitSelectors: [
    "ytd-video-renderer", // search results, sidebars
    "ytd-rich-item-renderer", // home feed tile
    "ytd-grid-video-renderer", // grid views
    "ytd-compact-video-renderer", // watch-page sidebar
    "ytd-playlist-renderer", // playlist result
    "ytd-channel-renderer", // channel result
    "ytd-reel-item-renderer", // Shorts (older markup)
    "ytm-shorts-lockup-view-model", // Shorts shelf lockup
    "ytd-watch-card-hero-video-renderer", // entity watch-card hero
    "ytd-watch-card-compact-video-renderer", // entity watch-card list item
  ],
};
