// Dependency-free static server for the demo site (demo/ at the repo root). The
// demo is never part of the build or dist/. It lets Ed load a polished, entirely
// made-up news site in his own Chrome with Diskard installed to take the Chrome
// Web Store screenshots. The filter term is read from the starter config and
// injected into the pages' __TERM__ placeholders at serve time, so no term
// literal lives in any scanned source file (the no-term-literals test stays
// green) and the pages always match whatever the starter term is.
//
//   npm run demo   ->   http://localhost:8080/  and  /full.html

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import starterConfig from "../src/config/starter-profiles.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = join(root, "demo");
const PORT = 8080;

/** The filter term, read from the config (never hard-coded here). */
const TERM = (starterConfig[0] && starterConfig[0].includeTerms && starterConfig[0].includeTerms[0]) || "the topic";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname.endsWith("/")) pathname += "index.html";
  // Resolve under demoDir and refuse any path that escapes it.
  const filePath = join(demoDir, normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, ""));
  if (filePath !== demoDir && !filePath.startsWith(demoDir + "\\") && !filePath.startsWith(demoDir + "/")) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    const ext = extname(filePath);
    let body = await readFile(filePath);
    if (ext === ".html") {
      body = Buffer.from(body.toString("utf8").split("__TERM__").join(TERM), "utf8");
    }
    res.writeHead(200, { "content-type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`Diskard demo site (filter term: "${TERM}") serving demo/ on port ${PORT}`);
  console.log(`  front page: http://localhost:${PORT}/`);
  console.log(`  cover page: http://localhost:${PORT}/full.html`);
});
