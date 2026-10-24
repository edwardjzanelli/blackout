# Site adapters

Each adapter is a small data file of selectors and container rules so that adding
a site is a data change, not an engine change (design 5.4). Planned adapters for
v0.1:

- **google-news** — article cards. Ed's original test target.
- **youtube** — video tiles (home, search, sidebar) and the Shorts shelf. Custom
  elements; titles are in the light DOM, so they are reachable.
- **facebook** — feed posts. Markup is obfuscated and changes often, so adapters
  anchor on ARIA roles, not class names. Highest maintenance cost.
- **generic** — fallback heuristics for `article`, `[role=article]` and `li`
  cards (design 5.1).

Instagram and LinkedIn are best effort only in v0.1 (design 2, 5.4).
