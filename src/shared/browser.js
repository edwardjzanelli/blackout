// One-line WebExtensions namespace shim, shared by every module (design 6a).

/**
 * The WebExtensions API, normalized across engines. Chrome exposes it as
 * `chrome`; Firefox and Safari expose the promise-based `browser`.
 * @type {typeof chrome}
 */
export const browser = globalThis.browser ?? globalThis.chrome;
