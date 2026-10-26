// Build the v0.1.0 Chrome Web Store zip. Does a clean normal (non-debug) build,
// then zips the CONTENTS of dist/chrome (manifest.json at the zip root) to
// c:\work\blackout\release\diskard-<version>.zip, outside the repo. No new
// dependency: the zip is written with node:zlib (raw deflate) plus the ZIP file
// format by hand.
//
//   npm run package

import { buildAll } from "./build.mjs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distChrome = join(root, "dist", "chrome");
const releaseDir = "c:/work/blackout/release";

/** CRC-32 (IEEE), used for each zip entry's checksum. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
};

/** Every file under dir, as {full, name} with a forward-slashed name relative
 * to base, sorted for a stable zip. */
async function listFiles(dir, base = dir) {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push({ full, name: relative(base, full).split(sep).join("/") });
  }
  return out;
}

// 1. Clean normal (non-debug) build. Imported, so no --debug flag is seen and the
//    debug-only regions are stripped.
await buildAll();

// 2. Zip the contents of dist/chrome (deflate).
const version = JSON.parse(await readFile(join(distChrome, "manifest.json"), "utf8")).version;
const outZip = join(releaseDir, `diskard-${version}.zip`);
const files = await listFiles(distChrome);

const localParts = [];
const centralParts = [];
let offset = 0;
for (const f of files) {
  const data = await readFile(f.full);
  const crc = crc32(data);
  const comp = deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(f.name, "utf8");

  const localHeader = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(comp.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf,
  ]);
  localParts.push(localHeader, comp);

  centralParts.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(comp.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(offset), nameBuf,
  ]));
  offset += localHeader.length + comp.length;
}

const central = Buffer.concat(centralParts);
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(central.length), u32(offset), u16(0),
]);

await mkdir(releaseDir, { recursive: true });
await writeFile(outZip, Buffer.concat([...localParts, central, eocd]));

const size = (await stat(outZip)).size;
console.log(`packaged ${files.length} files into ${outZip} (${size} bytes)`);
