// One-line WebExtensions namespace shim, shared by every module (design 6a).

/**
 * The WebExtensions API, normalized across engines. Chrome exposes it as
 * `chrome`; Firefox and Safari expose the promise-based `browser`.
 * @type {typeof chrome}
 */
export const browser = globalThis.browser ?? globalThis.chrome;

/**
 * Whether a real extension context is present (storage + runtime). Used to guard
 * the content-script entry point so that importing our modules into a plain web
 * page (where these APIs are absent) does nothing at all.
 * @param {typeof globalThis} [g]
 * @returns {boolean}
 */
export function hasExtensionApis(g = globalThis) {
  const api = g.browser ?? g.chrome;
  return Boolean(api && api.storage && api.runtime);
}
