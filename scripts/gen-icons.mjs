// Generates placeholder extension icons with Node built-ins only, no dependency.
// Each icon is a solid black square with a white horizontal bar. Re-run after
// changing the artwork: `node scripts/gen-icons.mjs`.

import { writeFile, mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48, 128];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "icons");

/** Precomputed CRC-32 table (IEEE polynomial), used for PNG chunk checksums. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number} unsigned CRC-32 of buf
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Wrap chunk data in a length/type/data/CRC PNG chunk.
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode a square 8-bit RGBA PNG: black field with a centred white bar.
 * @param {number} size
 * @returns {Buffer}
 */
function makePng(size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size); // one filter byte per scanline
  const barStart = Math.floor(size * 0.4);
  const barEnd = Math.ceil(size * 0.6);
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0; // filter type 0 (none)
    const white = y >= barStart && y < barEnd;
    const value = white ? 255 : 0;
    for (let x = 0; x < size; x++) {
      const o = rowOffset + 1 + x * 4;
      raw[o] = value;
      raw[o + 1] = value;
      raw[o + 2] = value;
      raw[o + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // compression (0), filter (0), interlace (0) already zeroed.

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir(iconsDir, { recursive: true });
for (const size of SIZES) {
  const file = join(iconsDir, `icon${size}.png`);
  await writeFile(file, makePng(size));
  console.log(`wrote ${file}`);
}
