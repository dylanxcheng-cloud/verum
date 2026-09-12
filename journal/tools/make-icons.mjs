// Generates PNG app icons without any image library (pure JS rasterizer + zlib).
// Usage: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance helpers (in 512-unit design space)
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const dx = Math.abs(x - cx) - hw + r, dy = Math.abs(y - cy) - hh + r;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
};
const sdSeg = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
};
const lerp = (a, b, t) => a + (b - a) * t;
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d)); // anti-aliased coverage from distance in px

function render(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 512;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / s, y = (py + 0.5) / s;
      // background: gradient
      const t = (x + y) / 1024;
      let r = lerp(0x4d, 0x18, t), g = lerp(0x8f, 0x5e, t), b = lerp(0xf5, 0xd3, t), a = 1;
      if (!maskable) {
        a = cover(sdRoundRect(x, y, 256, 256, 256, 256, 112) * s);
      }
      // inner panel
      const panel = cover(sdRoundRect(x, y, 256, 276, 136, 148, 36) * s) * 0.14;
      r = lerp(r, 255, panel); g = lerp(g, 255, panel); b = lerp(b, 255, panel);
      // check mark (two strokes, width 40 -> radius 20)
      const d = Math.min(sdSeg(x, y, 176, 262, 232, 318), sdSeg(x, y, 232, 318, 344, 194)) - 20;
      const ck = cover(d * s);
      r = lerp(r, 255, ck); g = lerp(g, 255, ck); b = lerp(b, 255, ck);
      const i = (py * size + px) * 4;
      buf[i] = Math.round(r); buf[i + 1] = Math.round(g); buf[i + 2] = Math.round(b); buf[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, buf);
}

writeFileSync(join(out, 'icon-192.png'), render(192));
writeFileSync(join(out, 'icon-512.png'), render(512));
writeFileSync(join(out, 'icon-maskable-512.png'), render(512, { maskable: true }));
writeFileSync(join(out, 'apple-touch-icon.png'), render(180, { maskable: true }));
console.log('icons written to', out);
