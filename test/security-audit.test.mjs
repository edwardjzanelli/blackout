// Pre-submission security guarantees (security review Part A). The extension
// forbids remote code (CSP), the page-writable debug flag is physically removed
// from a normal build, our modules do nothing when imported outside an extension
// context, and our injected shadow roots are closed so a page cannot read the
// user's blocked terms.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import manifest from "../src/manifest.base.json" with { type: "json" };
import { hasExtensionApis } from "../src/shared/browser.js";
import { stripDebugBlocks } from "../scripts/build.mjs";
import * as overlay from "../src/content/overlay.js";
import * as pageCover from "../src/content/page-cover.js";

const mainJsUrl = new URL("../src/content/main.js", import.meta.url);

test("A3: the extension CSP forbids remote code and plugins", () => {
  const csp = manifest.content_security_policy;
  assert.ok(csp && typeof csp.extension_pages === "string", "extension_pages CSP is set");
  assert.match(csp.extension_pages, /script-src 'self'/, "scripts only from the extension");
  assert.match(csp.extension_pages, /object-src 'self'/, "no remote plugins");
  assert.doesNotMatch(csp.extension_pages, /https?:|\*|unsafe-eval|unsafe-inline/, "no remote or unsafe sources");
});

test("A5: the page-writable no-page-rule debug flag is compiled out of a normal build", async () => {
  const source = await readFile(mainJsUrl, "utf8");
  // The source carries the hook, inside a debug-only region.
  assert.match(source, /@debug-only:start/, "source marks the region as debug-only");
  assert.match(source, /blackout:no-page-rule/, "source contains the hook");

  const shipped = stripDebugBlocks(source); // what a normal (non-debug) build emits
  assert.doesNotMatch(shipped, /blackout:no-page-rule/, "hook key is gone from the shipped build");
  assert.doesNotMatch(shipped, /localStorage/, "no localStorage read in the shipped build");

  // The whole-page cover explanation (debug-only diagnostics) is also stripped.
  assert.match(source, /function explainCover/, "source has the cover explanation");
  assert.doesNotMatch(shipped, /explainCover|gatherReferences|annotateCover/, "cover diagnostics stripped from the shipped build");
});

test("A6: our modules are inert outside an extension context (no storage/runtime)", () => {
  assert.equal(hasExtensionApis({}), false, "nothing present");
  assert.equal(hasExtensionApis({ chrome: {} }), false, "chrome without storage/runtime");
  assert.equal(hasExtensionApis({ chrome: { storage: {} } }), false, "storage but no runtime");
  assert.equal(hasExtensionApis({ chrome: { storage: {}, runtime: {} } }), true, "real extension context");
  assert.equal(hasExtensionApis({ browser: { storage: {}, runtime: {} } }), true, "Firefox/Safari namespace");
});

test("A7: injected mask and cover shadow roots are closed (a page cannot read the term)", () => {
  const { window } = new JSDOM("<!doctype html><body><article><p>a story</p></article></body>");
  const { document } = window;

  const container = document.querySelector("article");
  overlay.blackout(container, "Secret Term", { window });
  pageCover.coverPage(document, "Secret Term", { window });

  const maskHost = container.querySelector(".blackout-ui");
  const coverHost = document.getElementById("blackout-page-cover");

  // A page script sees null for a closed root: it cannot read the label text.
  assert.equal(maskHost.shadowRoot, null, "mask shadow root is closed to page scripts");
  assert.equal(coverHost.shadowRoot, null, "cover shadow root is closed to page scripts");

  // Our own accessor (same module realm) can still reach it, and the term is
  // only there, never in the open DOM.
  assert.ok(overlay.shadowRootFor(maskHost), "our code can reach the mask root");
  assert.ok(pageCover.shadowRootFor(coverHost), "our code can reach the cover root");
  assert.ok(!/Secret Term/.test(container.outerHTML), "the term is not exposed in the light DOM");
});
