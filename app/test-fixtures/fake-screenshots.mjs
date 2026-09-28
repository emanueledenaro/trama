#!/usr/bin/env node
// Stand-in for a project's screenshot script (issue #247), used by tests and the UI check only. It draws one screen of
// a shop as a PNG in TRAMA_SCREENSHOTS_DIR: the page in the theme TRAMA_THEME (light or dark) and a button in the color
// `--accent` of web/index.css, so the base and the candidate differ when the candidate changes that color.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const out = process.env.TRAMA_SCREENSHOTS_DIR;
if (!out) {
  console.error("TRAMA_SCREENSHOTS_DIR is not set");
  process.exit(2);
}
const dark = process.env.TRAMA_THEME === "dark";
const css = existsSync("web/index.css") ? readFileSync("web/index.css", "utf8") : "";
const hex = css.match(/--accent:\s*#([0-9a-f]{6})/i)?.[1] ?? "8a8a8a";
const accent = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const page = dark ? [29, 28, 26] : [244, 241, 234];
const card = dark ? [44, 42, 39] : [255, 255, 255];
const text = dark ? [120, 116, 110] : [200, 196, 188];

const width = 320;
const height = 200;
const inside = (x, y, [x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1;
const pixel = (x, y) => {
  if (inside(x, y, [180, 140, 290, 170])) return accent;
  if (inside(x, y, [40, 50, 220, 60]) || inside(x, y, [40, 72, 180, 80])) return text;
  if (inside(x, y, [24, 24, 296, 184])) return card;
  return page;
};
const rows = [];
for (let y = 0; y < height; y++) {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) Buffer.from(pixel(x, y)).copy(row, 1 + x * 3);
  rows.push(row);
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 2;
writeFileSync(
  join(out, "checkout.png"),
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]),
);
