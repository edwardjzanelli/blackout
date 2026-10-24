# Blackout (working name, see §14)

Product and Technical Design • Version 0.1 • October 23, 2026

Status: Proposed MVP specification. Estimates are planning assumptions, not commitments.

> **Review markup (Claude, 2026-10-23).** Ed's structure and numbering are unchanged. Additions are numbered as insertions (3.5, 6a, FR-12...) and tagged **[ADDED]**. Changed text is tagged **[CHANGED]** with the original kept in ~~strikethrough~~. Proposed answers to open questions are tagged **[PROPOSED]**.

# 1. Executive summary

Blackout is a privacy-conscious ~~Chrome extension~~ **[CHANGED]** browser extension (Chrome first; other Chromium browsers, Firefox and Safari from the same source) that obscures unwanted topics, people, and spoilers in webpages. Users define filter profiles containing terms and matching rules. When a content unit matches, Blackout ~~places an opaque overlay over~~ **[CHANGED]** blacks out that unit while preserving its original size and layout. Users can optionally reveal a blocked item. Filters can be permanent or expire automatically.

Initial use cases: suppress Kardashian-related articles; avoid coverage of selected public figures; temporarily hide Survivor spoilers until an episode has been watched.

**1a. [ADDED] Positioning.** Blackout is topic-neutral. It ships with no political presets; every profile is user-created or user-deletable. The product's voice (name, overlay copy, counter) carries the snark, not the filter list.

# 2. Goals and non-goals

## MVP goals

- Create, edit, enable, pause, and delete filter profiles.
- Black out matched news/article cards and isolated text blocks without collapsing layout.
- Reveal individual blacked-out units on demand; allow re-blackout.
- Support expiration dates/times and a global pause switch.
- ~~Show a local history of blocking events and summary counts.~~ **[CHANGED]** Show a local blocked-item counter (per page, today, all time). Full event history moves to P1.
- Operate locally with no account, backend, analytics service, or remote AI.
- **[ADDED]** Work on the feeds where this content actually appears: Google News, YouTube and Facebook (see §5.4), not only news sites.
- **[ADDED]** v0.1 development complete by Friday, October 30, 2026. Store submission follows (see §12a).
- **[ADDED]** Publisher: Ed Zanelli, personally, on every store listing and on the website.

## Not in MVP

- Recognizing people from uncaptioned photographs.
- Understanding semantic references with no keyword or metadata match.
- Guaranteeing coverage of every site, embedded iframe, or shadow-root component.
- Filtering browser tabs, native mobile apps, email clients, or other browsers.
- ~~Synchronizing settings between devices~~ **[CHANGED]** sharing public filter packs. **Same-browser sync is in v0.1: profiles and preferences live in the browser's own sync storage (storage.sync), so they follow the user across devices signed in to the same browser (§6.3). Cross-browser sync is not in scope.**
- **[ADDED]** Safari (macOS and iOS) and Firefox store listings. Code stays portable from day one; these listings follow in v0.2 (see §6a).
- **[ADDED]** Instagram and LinkedIn feeds as supported targets (best effort only).

# 3. User experience

## 3.1 Toolbar popup

- Global On/Pause toggle and current-site status.
- Count of blacked-out units on the current page.
- Quick access to filter profiles and full settings.
- Optional temporary pause for the current website.
- **[ADDED]** Running total in the product's voice (for example "Brain cells saved: 1,204"). This is the screenshot people will share.

## 3.2 Settings dashboard

- Filters: name, terms, enabled status, matching mode, blackout behavior, expiration, edit/delete.
- History: timestamp, site domain, matched profile, action (blocked/revealed), optionally page title; searchable and clearable. **[CHANGED] P1, not in the Friday build.**
- Statistics: total blocked, counts by profile/site, time window. **[CHANGED] Friday build: total and per-profile counts only.**
- Preferences: overlay style, reveal policy, history retention, site allowlist, global pause.

## 3.3 Blacked-out content

Default presentation: an opaque, accessible overlay occupying the content unit's original area, labeled "Content blacked out," with the matching profile name and a Reveal control. Reveal is per unit and lasts until the page reloads; the user can black it out again. Overlays must not leak underlying headlines, image alt text, or link previews on hover. Keyboard activation and visible focus are required.

**3.3a [ADDED] [CHANGED]** The label rotates through a short list of snarky lines (for example "Spared you this one." / "You're welcome."), with a preference for the plain "Content blacked out." ~~Profile name stays visible so the user knows which filter fired.~~ **The label shows the matched filter term exactly as the user entered it (for example "Kardashian"), not a profile name, so the user knows which filter fired. This is the same rule as the whole-page label (§3.6).**

## 3.4 Temporary spoiler filters

A user creates "Survivor spoilers," enters phrases such as Survivor, tribal council, and voted off, then sets an expiration time. The profile automatically stops matching after expiration. Because generic phrases may cause false positives, the interface warns about broad terms and supports site-specific scope and phrase matching.

## 3.5 [ADDED] First run and permissions

Automatic filtering needs access to all sites, and Chrome shows that as "Read and change all your data on all websites." Someone arriving from a social post will see that warning before anything else. The first-run page must say, in one screen, that nothing leaves the device, that there is no network code, and link to the source (see §9a). The first-run page also offers one starter profile (Kardashians) pre-filled and enabled, so the extension does something visible on the first page the user opens. The user can edit or delete it like any other.

**3.6 [ADDED] Whole-page blackout.** When a page is mostly blocked content, Blackout covers the whole window instead of blacking out every story. The cover uses the same mechanism as a card mask (§8a): label, profile name, **Reveal**, **Black out again**. Reveal lasts until the page reloads. The label reads "Lots of *term* references on this page, so we blocked out the entire page.", where *term* is the filter term exactly as the user entered it, choosing the most frequently matched one when several match. The whole page is covered when either:
1. the page title or the URL's search words match an active filter, or
2. more than half of the detected stories on the page match, with at least 6 matching.

Both thresholds (half, 6) are preferences, so they can be tuned later. **[ADDED]** Whole-page and per-card blackout are either/or: once a page is in whole-page mode, Reveal shows it completely unmasked, and Black out again restores the whole-page cover.

# 4. Functional requirements

| ID    | Requirement                                           | Priority |
|-------|-------------------------------------------------------|----------|
| FR-01 | Create/edit/delete named filter profiles              | P0       |
| FR-02 | Enable/disable profiles and global pause              | P0       |
| FR-03 | Case-insensitive phrase matching with word boundaries **[CHANGED] plus plural and possessive forms (Kardashians, Kardashian's)** | P0       |
| FR-04 | Overlay a bounded content unit and preserve layout    | P0       |
| FR-05 | Click or keyboard reveal and re-blackout              | P0       |
| FR-06 | Handle newly loaded content via MutationObserver      | P0       |
| FR-07 | Profile expiration date/time                          | P0       |
| FR-08 | Local blocking history and clear history              | ~~P0~~ **P1 [CHANGED]** |
| FR-09 | Per-site allowlist and current-site pause             | P1       |
| FR-10 | Import/export filter profiles                         | P2       |
| FR-11 | Semantic/image recognition                            | Later    |
| FR-12 | **[ADDED]** Blocked-item counter (page, today, all time) | P0    |
| FR-13 | **[ADDED]** First-run page with permission explanation and starter profile | P0 |
| FR-14 | **[ADDED]** Site adapters for Google News, YouTube, Facebook (§5.4) | P0 |
| FR-15 | **[ADDED]** Single-source build that emits per-browser packages (§6a) | P0 (Chrome), P1 (Firefox, Safari) |
| FR-16 | **[ADDED]** Exclusion terms per profile (UI for the existing `excludeTerms`) | P1 |
| FR-17 | **[ADDED]** Whole-page blackout per §3.6 | P0 |

# 5. Matching and content selection

## 5.1 Matching pipeline

1. Collect candidate text from visible DOM text, titles, aria labels, image alt text, and link metadata within a bounded element.
2. Normalize Unicode and whitespace; perform case-insensitive phrase matching with word boundaries.
3. Evaluate active profiles and expiry.
4. Find the smallest suitable containing article/card element.
5. Apply a non-destructive overlay.
6. Record a deduplicated event.

Initial candidate containers: article, listitem, common article-card elements, and known site-specific selectors. Use conservative heuristics to avoid selecting body, main, feed containers, navigation, or unusually large ancestors. If a safe card boundary cannot be identified, mask only the smallest matched text region or skip the item rather than obscuring the page.

**5.1a [ADDED] Order of work.** Run steps 1 to 3 bottom-up: walk text nodes and the listed attributes in the changed subtree with a TreeWalker, test them against one compiled regex built from all active profiles, and only on a hit walk up to the container (step 4). Starting from candidate containers and reading their text costs far more on long feeds. Word boundaries must be Unicode-aware (`\p{L}` lookarounds with the `u` flag), not `\b`, which treats accented letters as boundaries.

## 5.2 False positives

Avoid standalone ambiguous first names such as "Kim." Prefer full names and distinctive terms; provide exact phrase matching and optional exclusions. Do not assume that every reference to "Survivor" is a spoiler. Match terms against card text rather than unrelated page-wide navigation or recommendations.

**5.2a [ADDED]** The editor warns when a term is a single common word or under five letters. A per-profile site scope (already in the data model as `siteScope`) is the main defense for spoiler profiles: "Survivor" on cbs.com and news sites, not everywhere.

## 5.3 Dynamic pages and performance

A throttled MutationObserver processes only changed subtrees. Cache processed elements with WeakSet/WeakMap and invalidate when their relevant text changes. Batch DOM reads and writes; cap work per cycle. Re-evaluate when profiles or pause settings change. Prevent extension-inserted overlay elements from triggering recursive matching.

**5.3a [ADDED]** Matching must finish before first paint where possible: run the content script at `document_start` and observe from there, so a matched card is never visible for a frame and then blacked out. Facebook and YouTube recycle DOM nodes in their virtualized feeds, so a cached "already processed" node can later hold different content; the cache key is the node plus a hash of its text, not the node alone.

## 5.4 [ADDED] Target sites

Google News alone will not convince anyone. People install this after seeing a celebrity or politician in their feed, so the first-hour test is Facebook or YouTube. Friday target set:

| Site | Container | Notes |
|------|-----------|-------|
| Google News | article cards | Ed's original test target |
| YouTube | video tiles (home, search, sidebar), Shorts shelf | Custom elements; titles are in light DOM, so reachable |
| Facebook | feed posts | Markup is obfuscated and changes often; anchor on ARIA roles, not class names. Highest maintenance cost |
| Generic | `article`, `[role=article]`, `li` cards | Fallback heuristics from §5.1 |

Instagram and LinkedIn are best effort in v0.1. Each site adapter is a small file of selectors and container rules, so adding a site is a data change, not an engine change.

# 6. Technical architecture

Platform: ~~Chrome Extension Manifest V3~~ **[CHANGED]** WebExtensions Manifest V3 (Chrome first), vanilla JavaScript, HTML, CSS. No external services. Core components:

| Component          | Responsibility                                                |
|--------------------|---------------------------------------------------------------|
| manifest.json      | Permissions, extension entry points, host scope               |
| content script     | DOM discovery, matching, overlays, reveal interactions        |
| matching module    | Normalization, rule evaluation, exclusions                    |
| container resolver | Identify safe content unit boundaries                         |
| service worker     | Expiration housekeeping and message coordination where needed |
| popup              | Quick pause/status/actions                                    |
| options page       | Filter editor, history, statistics, preferences               |
| storage layer      | Schema validation, migrations, retention, deduplication       |
| **[ADDED]** site adapters | Per-site selectors and container rules (§5.4)          |
| **[ADDED]** build script  | Emits one package per browser from one source tree (§6a) |

~~Use chrome.storage.local for profiles/preferences and a bounded history for MVP.~~ **[CHANGED]** Use **chrome.storage.sync for profiles and preferences (one item per profile, §6.3), with chrome.storage.local as the fallback on quota errors or when sync is unavailable. Per-device and runtime state (revealed items, counters, a bounded history) stay in chrome.storage.local.** Prefer minimal permissions: storage, activeTab where useful, and host permissions needed for automatic page scanning. Automatic filtering across websites requires user-granted site access; this should be explained clearly during installation. Avoid broad network permissions and remote code.

**6.1 [ADDED]** The service worker may not be needed at all. Expiry can be checked by the content script at match time (`expiresAt < now` means skip), which is exact and needs no alarms. Only the popup badge count needs a background context. Fewer moving parts, and one less thing that differs between browsers.

**6.2 [ADDED] [PROPOSED] Language and repo.** Plain JavaScript (ES modules), HTML and CSS, with JSDoc type comments; no framework and no bundler, so the shipped code is the code that was written (readable for store review, §9a). Node is used only for development tooling: the per-browser build script (§6a) and tests. Repo root `c:\work\blackout\blackout`; anything not in the repo (store assets in progress, notes, credentials) lives in `c:\work\blackout`.

**6.3 [ADDED] Filter terms and storage.** Filter terms are user data stored in the browser's own sync storage (storage.sync), so they follow the user across devices signed in to the same browser. src/config/starter-profiles.json holds starter defaults only, used to seed sync once; no term is hard-coded elsewhere, and no text is generated from a term (no pluralizing).

## 6a. [ADDED] Browser support: single source, browser-specific where forced

All code (content script, matcher, adapters, popup, options) is shared. The browser-specific parts are the manifest and packaging, handled by a small build script. Use the `browser.*` namespace through a one-line shim (`globalThis.browser ?? globalThis.chrome`); MV3 APIs used here (storage, runtime messaging) are promise-based in all four engines.

| Browser | Same package? | What differs | Cost to add |
|---------|---------------|--------------|-------------|
| Chrome | Base | None | Base. $5 one-time developer registration |
| Edge, Brave, Opera, Vivaldi, Arc | Yes (Chromium) | Nothing. Edge users can install straight from the Chrome Web Store; a separate Edge Add-ons listing is optional and free | ~1 hour for an Edge listing |
| Firefox (desktop and Android) | Same code, different manifest | `background.scripts` instead of `background.service_worker`; `browser_specific_settings.gecko.id` required. Moot if §6.1 drops the background | ~2 to 4 hours plus AMO review |
| Safari (macOS, iOS) | Same code, wrapped in an Xcode app | Requires a Mac with full Xcode, Apple's converter (`xcrun safari-web-extension-converter`), App Store submission, $99/yr Apple Developer Program enrollment in Ed's personal name (allow a few days for Apple's identity verification). iOS needs its own app target and testing against mobile site layouts | ~1 to 2 days the first time, plus App Review |

Why Firefox earns a place before Safari: Firefox for Android supports extensions, which makes it the only mainstream way to run this on an Android phone. Chrome on Android does not support extensions.

Why Safari matters anyway: most Safari use is iPhone. A macOS-only Safari build reaches few people; the iOS build is the one worth doing, and it is the most work.

# 7. Data model

Illustrative persisted objects (conceptual, not final API):

| Object        | Fields |
|---------------|--------|
| FilterProfile | id, name, enabled, includeTerms\[\], excludeTerms\[\], matchMode, expiresAt\|null, siteScope\[\], createdAt, updatedAt |
| Preferences   | globalEnabled, defaultAction=blackout, allowReveal, siteAllowlist\[\], historyRetentionDays **[ADDED]** , snarkyLabels |
| BlockEvent    | id, timestamp, domain, profileId, pageKey, itemFingerprint, eventType **[CHANGED] P1** |
| **[ADDED]** Counters | totalBlocked, byProfile{}, todayDate, todayCount |
| Runtime state | revealed element IDs (page memory), observer state, deduplication cache |

Store history without article body text or URLs by default. Domain, profile, and timestamp should suffice for most reporting. Make history optional, bounded (for example 30 days or 5,000 events), and user-clearable. Avoid logging each MutationObserver scan as a new block event.

**7a. [ADDED]** Add a `schemaVersion` key from the first release. Users will install v0.1 from the store and carry their profiles into every later version; migrations need something to branch on.

# 8. Overlay implementation

Preserve the original content node and its dimensions. For suitable card containers, position a cover layer over the unit with a high local stacking order. Do not modify underlying article text or remove nodes. Ensure scrolling, layout, and responsive sizing remain stable. A single full-card overlay may need ResizeObserver to track dimension changes. Restore previous styles and remove injected nodes when a filter is disabled or a site is paused.

Special cases: small inline mentions should use text-range masking rather than a giant overlay; links and buttons beneath the cover must not be accidentally activated; fixed/sticky elements, nested cards, cross-origin iframes, canvas-rendered content, and closed shadow DOM may be unsupported initially.

**8a. [ADDED] Recommended change: style the container instead of covering it.** Rather than a separate positioned layer that must track the card, add one class to the matched container. A stylesheet injected by the extension sets the container's background to black and every child to `visibility: hidden`, then a single injected child holds the label and Reveal button. Results:

- Layout is preserved exactly, because hidden children still occupy their space. No ResizeObserver, no position tracking, no sticky/scroll edge cases.
- Hidden elements cannot be clicked, hovered or tab-focused, so link activation and hover previews (two §8 special cases and a §3.3 requirement) are solved by the same rule.
- Reveal and cleanup are one class removal. Nothing on the page is restyled inline.

The injected child lives in a shadow root so the site's CSS cannot restyle the label. One caveat: the container may need `position: relative` for the label, which can affect absolutely positioned descendants on some sites; the adapter can opt out per site.

**8b. [ADDED] [CHANGED]** Inline text-range masking (§13, last question) is P1. ~~For v0.1 a match with no safe container is skipped and counted, not masked.~~ **A matched word is never left visible. Where no safe card container exists (topic chips, "Follow this topic" links, section headings, sidebar entries), mask the smallest element that contains the match, its own link, chip, heading or span, using the same §8a mechanism. The size, inputs and forbidden-boundary rules still apply to that element, so never `<main>`, `<body>`, feeds or nav containers themselves; a link or chip inside nav is fine.**

**8c. [ADDED]** The mask UI is responsive to the masked element's size, using CSS container queries inside the shadow root (no JavaScript layout loop): a tall card shows the stacked label, term and Reveal; a shorter one shows the term and Reveal in a row; shorter or narrower still drops the label first, then the term. The Reveal button (and "Black out again") is never dropped and is never clipped: it keeps a minimum clickable height of 24 px with readable text. If a masked element is shorter than that minimum, its `min-height` is grown just enough to fit the button, the one accepted layout change on the page element; the previous value is recorded and restored exactly on Reveal and on cleanup.

# 9. Security, privacy, and accessibility

- All matching and history processing happen on the user's device. No browsing data is transmitted.
- Treat webpage content as untrusted. Use textContent and DOM APIs, never interpolate page content into innerHTML.
- Keep extension UI isolated from page styles where practical; use strict Content Security Policy.
- Provide keyboard-operable Reveal/Blackout buttons, accessible labels, and sufficient contrast.
- Avoid blocking login forms, checkout flows, consent dialogs, or large page regions.
- Provide one-click global pause and per-site exclusions as escape hatches.

**9a. [ADDED] Store and trust requirements.**

- The Chrome Web Store listing requires a privacy-practices declaration and a written justification for broad host access. Both are short because nothing is collected, but they must be filled in before submission.
- Publish a one-page privacy policy (edzanelli.com is fine) and, ideally, the source on GitHub. An extension that can read every page is the classic vector for later abuse; open source plus no network permission is the strongest answer to "why should I trust this."
- Ship unminified code. Google's review guidance says minified code slows review.
- Never sell or transfer the extension. Popular extensions get acquisition offers whose purpose is to push malicious updates to the installed base.

# 10. Test plan and acceptance criteria

| Test                                        | Expected outcome |
|---------------------------------------------|------------------|
| Google News card with "Kardashian" headline | Entire card is obscured without shifting adjacent cards |
| Unrelated "Kim" article                     | Not blocked by a full-name-only rule |
| Infinite scrolling feed                     | New matching cards are obscured once, without duplicates |
| Reveal card                                 | Original card visible; click does not inadvertently open article |
| Disable profile                             | Affected overlays are removed immediately |
| Expired spoiler profile                     | Stops matching at or after expiration without manual deletion |
| Global pause                                | All overlays removed; scanning suspended |
| History                                     | One event per blocked content unit, clearable and retention-limited **[CHANGED] P1** |
| Large article page                          | Page body is not accidentally entirely covered |
| **[ADDED]** "Kardashians'" and "Kardashian's" | Matched by a "Kardashian" term |
| **[ADDED]** YouTube home and search          | Matching video tiles blacked out; no flash of the thumbnail before blackout |
| **[ADDED]** Facebook feed, scroll 100 posts  | Matching posts blacked out; recycled nodes re-evaluated; scrolling stays smooth |
| **[ADDED]** Fresh install                    | First-run page shows; starter profile blacks out a matching card on the next page load |

Performance target for the MVP: no noticeable scrolling degradation on representative news feeds. Measure actual scan latency and memory usage during testing rather than promising a fixed universal threshold.

# 11. Development plan and effort

| Workstream                               | Estimate    |
|------------------------------------------|-------------|
| Scaffold, manifest, permissions, storage | 2–3 hours   |
| Rule engine and container heuristics     | 4–6 hours   |
| Overlay, reveal, cleanup                 | ~~4–6 hours~~ **[CHANGED] 2–3 hours with §8a** |
| Popup and settings UI                    | 4–6 hours   |
| Expiration, history, statistics          | ~~3–5 hours~~ **[CHANGED] 1–2 hours: expiry + counters only; history is P1** |
| Dynamic DOM and performance              | 3–5 hours   |
| Cross-site QA and fixes                  | 5–8 hours   |
| **[ADDED]** Site adapters (YouTube, Facebook) | 3–5 hours |
| **[ADDED]** First-run page, store listing, icons, screenshots, privacy policy | 3–4 hours |
| Total                                    | ~~25–39 hours~~ **[CHANGED] 27–42 hours** |

A focused 15–20-hour weekend can yield a functional personal prototype. A more reliable MVP with settings, history, expiration, and testing is better budgeted at roughly 25–40 hours over a weekend plus several days. Chrome Web Store publication, review, privacy disclosures, and additional compatibility work are separate.

# 12. Milestones

- M1: Load unpacked extension; block and reveal a known test article.
- M2: Multiple editable profiles, pause, and safe content-unit selection.
- M3: Settings dashboard, expiration, history, and statistics.
- M4: Validate Google News and two additional representative sites; fix layout/performance issues.
- M5: Package, document installation, and decide whether to pursue public release.

**12a. [ADDED] Dated plan: v0.1 development complete Friday, October 30.** Store publication is a separate step after that. The Chrome Web Store says most reviews finish within a few days but can take up to a few weeks, and lists new developers, new extensions and broad host permissions (all three apply) as factors that lengthen review.

| Date | Milestone |
|------|-----------|
| Sat Oct 24 to Sun Oct 25 | M1 + M2 |
| Mon Oct 26 to Tue Oct 27 | M3 (as cut in §3.2) + §8a overlay + first-run page |
| Wed Oct 28 to Thu Oct 29 | M4 on Google News, YouTube, Facebook; fixes |
| Fri Oct 30 | v0.1 development complete: all §10 tests pass on Chrome. M5 (package, listing assets) |
| After Oct 30 | Chrome Web Store submission and review; website live; launch posts once the listing is public |
| v0.2 | Firefox (desktop + Android), Edge Add-ons listing, then Safari macOS + iOS |

# 13. Open decisions

- Should Reveal be always available, or optionally disabled per profile?
  **[PROPOSED]** Always available in v0.1. A per-profile "no reveal" is a P2 nicety for people blocking themselves from spoilers.
- Should temporary filters expire at a specific local time or when manually marked "watched"?
  **[PROPOSED]** Both, and they are the same field: a time picker plus a "Watched it, turn this off" button in the popup that sets `expiresAt = now`.
- Should history capture only counts, or also page titles and links (with additional privacy implications)?
  **[PROPOSED]** Counts only in v0.1. Titles and links are the very content the user asked not to see; storing and displaying them in a history list defeats the product.
- Which three websites should be explicitly supported and tested first?
  **[PROPOSED]** Google News, YouTube, Facebook (§5.4).
- Should masking of isolated inline references be included in version 0.1 or postponed?
  **[PROPOSED]** Postponed (§8b).

Recommendation: use a single default blackout behavior, allow reveal, store minimal local history, support explicit expiry times, and validate against Google News plus two user-selected sites before expanding coverage.

**13a. [ADDED] New open decisions for Ed**

- ~~Publisher identity~~ **Decided 2026-10-23:** Ed Zanelli, personally.
- Is there a Mac available for the Safari build (v0.2)?
- Launch copy: the code is neutral, but naming a politician in the launch post is what will be read as political. Kardashians and spoilers carry the joke without that.

# 14. [ADDED] Name

Avoid real people's names in the product name (store trademark/impersonation rules, and it narrows the product). Check the Chrome Web Store and a trademark search for each before choosing; none of these have been checked yet.

| Name | Tagline idea | Note |
|------|--------------|------|
| Brain Cell Saver | "I felt dumber every time I heard about them. So I stopped." | Pairs with the "brain cells saved" counter; strongest tie to the origin story |
| Spare Me | "Spared you 1,204 times this week." | Short, works as overlay copy |
| Unsee | "Some things can't be unseen. Now they don't have to be seen." | Clean, likely contested |
| Hard Pass | "Hard pass on 37 items today." | Casual, broad |
| Who? | "Never heard of them." | Funniest, hardest to search for |
| Selective Amnesia | "Forget them on purpose." | Long but distinctive |

# 15. [ADDED] Launch and distribution

- Most people who see a LinkedIn, Facebook or Instagram post are on a phone, and Chrome on phones cannot install extensions. The post should link to a landing page (edzanelli.com) that installs on desktop and, on mobile, offers "send me the link" or plain instructions for later.
- Instagram does not make links in post captions clickable; the link goes in the bio or a story link sticker.
- A 15 to 30 second screen recording (feed before, feed after, counter ticking up) will do more than any copy.

**15a. [ADDED] [PROPOSED] Website hosting.** The site is static: a few pages of copy, the privacy policy and store links. Host it as a static site (S3 + CloudFront, or Amplify) on its own domain once the name is chosen. No EC2 or RDS: the extension has no backend by design, and a server plus database would cost a recurring monthly bill, need patching, and undercut the "nothing leaves your device" promise. If an email signup is wanted later, a single Lambda can be added then.
