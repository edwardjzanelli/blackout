// Facebook adapter (design 5.4). Data only. Facebook's class names are
// obfuscated and change often, so we anchor only on ARIA roles: a post is
// role=article, inside a role=feed. role=article is already a generic content
// unit, but listing it here documents Facebook's post boundary and keeps the
// site's rule where a maintainer will look for it.

/** @type {import("./index.js").Adapter} */
export default {
  hosts: ["facebook.com"],
  unitSelectors: [
    '[role="article"]', // a post (feed, search, permalink, watch)
  ],
};
