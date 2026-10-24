// Instagram adapter (design 5.4). Data only. Feed posts are <article>; profile,
// explore and search grids are tiles that are links to a post or reel permalink.
// Instagram puts the caption in the image's alt text, so a match often lands on
// an <img alt> inside the tile and we walk up to the permalink link. We anchor
// on the role and the permalink href shape, never on obfuscated class names.

/** @type {import("./index.js").Adapter} */
export default {
  hosts: ["instagram.com"],
  unitSelectors: [
    "article", // feed post
    'a[role="link"][href*="/p/"]', // grid tile -> post permalink
    'a[role="link"][href*="/reel/"]', // grid tile -> reel permalink
  ],
};
