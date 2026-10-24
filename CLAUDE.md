# Blackout — standing rules for Claude

Blackout is a browser extension that blacks out unwanted topics, people and
spoilers on web pages. The design lives in
`design/Blackout_Design_Document_v0.1.md`; read it before changing behaviour.

## Publisher and identity
- The publisher is **Ed Zanelli**, personally, on every store listing and on the
  website. There is no company.
- Never mention any other project or employer anywhere: not in code, docs,
  comments, metadata, or commit messages.

## Language and dependencies
- Plain JavaScript (ES modules), HTML and CSS, with JSDoc type comments. No
  framework, no bundler, no minification, no runtime dependencies.
- Dev dependencies only when genuinely unavoidable. Prefer Node built-ins
  (`node:test`, `node:fs`, `node:zlib`, ...) over packages.
- The shipped code is the code that was written, so store reviewers can read it.

## Privacy and security (non-negotiable)
- The extension makes **no network requests**, ever: no `fetch`, XHR,
  WebSocket, beacon, or remote code. All processing stays on the device.
- Page content is untrusted. Never put page text into `innerHTML`; use
  `textContent` and DOM APIs.

## Environment and commands
- Ed runs commands from **Windows PowerShell** on the machine `mimma`. Any
  command written for Ed must be PowerShell, with no Unix shell constructs.

## Git
- Leave changes uncommitted until Ed has reviewed the diff and approved.
- Commits are clean, bisectable units with long, detailed messages.
- Never push without Ed's sign-off.

## Published copy
- Anything published (store listing, website copy, overlay text) uses **no em
  dashes**.
- Website copy is in Ed's first person: "email me", never "email Ed".

## Tests
- Targeted runs only, not the whole suite by reflex.
- A red test gets exactly one of three outcomes: fix the test, fix the code, or
  drop the test.

## Design doc edits
- Preserve the existing structure and numbering. Mark additions as insertions
  (for example 3.5, 6a, FR-17) rather than renumbering what is already there.
