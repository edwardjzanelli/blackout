// Classic content script: bootstraps the ES module graph (design 6a, 6.2).
// Manifest content scripts cannot be ES modules, so this one classic file
// dynamic-imports main.js via runtime.getURL. Everything else stays a testable
// module listed under web_accessible_resources.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const url = api.runtime.getURL("content/main.js");
  import(url).catch((err) => {
    console.error("[blackout] failed to load main module", err);
  });
})();
