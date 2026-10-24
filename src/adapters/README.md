# Site adapters

Each adapter is a small data file of selectors and container rules so that adding
a site is a data change, not an engine change (design 5.4). Planned adapters for
v0.1:

- **google-news** — article cards. Ed's original test target.
- **youtube** — video tiles (home, search, sidebar) and the Shorts shelf. Custom
  elements; titles are in the light DOM, so they are reachable.
- **facebook** — feed posts. Markup is obfuscated and changes often, so adapters
  anchor on ARIA roles (`role=article`), not class names. Highest maintenance cost.
- **instagram** — feed `article` posts and explore/search grid tiles (links to a
  post or reel permalink). Captions live in the image `alt` text, so a match
  often lands on an `<img alt>`; anchor on the role and permalink `href`.
- **generic** — fallback heuristics for `article`, `[role=article]` and `li`
  cards (design 5.1).

When a site adapter is active, the generic card-class and repeated-DIV guesses
are turned off: the adapter names the real content units, so a match outside
every named unit falls to the smallest safe element rather than being guessed
into a layout block (which, on these sites, over-captures whole shelves).

LinkedIn is best effort only in v0.1 (design 2, 5.4).
