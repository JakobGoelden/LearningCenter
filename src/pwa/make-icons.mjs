// Draws the app icons in public/icons/ from the logo (src/ui/Emblem.tsx, Logo).
// No image tools needed: a tiny rasterizer and PNG encoder.
// Run: node src/pwa/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../../public/icons/', import.meta.url);

// Logo geometry in its 32×32 box.
const cubic = (p0, p1, p2, p3, n = 24) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n, u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  });
const leftPage = [[7, 11.5], ...cubic([7, 11.5], [10, 10.2], [13, 10.4], [16, 12.4]), [16, 23.4], ...cubic([16, 23.4], [13, 21.4], [10, 21.2], [7, 22.5])];
const rightPage = [[25, 11.5], ...cubic([25, 11.5], [22, 10.2], [19, 10.4], [16, 12.4]), [16, 23.4], ...cubic([16, 23.4], [19, 21.4], [22, 21.2], [25, 22.5])];
const arc = [[10, 8.5], ...cubic([10, 8.5], [13.7, 6], [18.3, 6], [22, 8.5])];

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearPolyline(x, y, line, r) {
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r * r) return true;
  }
  return false;
}
function inRoundedRect(x, y, size, r) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = Math.max(r, Math.min(size - r, x)), cy = Math.max(r, Math.min(size - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const A = [0x5b, 0x7b, 0xff], B = [0x8b, 0x5c, 0xf6];

/** RGBA pixels. `radius` 0 = full bleed; `scale` shrinks the motif around the centre. */
function draw(px, { radius, scale }) {
  const data = Buffer.alloc(px * px * 4);
  const S = 4; // 4×4 samples per pixel
  for (let py = 0; py < px; py++) {
    for (let qx = 0; qx < px; qx++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((qx + (sx + 0.5) / S) / px) * 32, y = ((py + (sy + 0.5) / S) / px) * 32;
          if (radius > 0 && !inRoundedRect(x, y, 32, radius)) continue;
          const t = (x + y) / 64;
          let c = A.map((v, i) => v + (B[i] - v) * t);
          const mx = 16 + (x - 16) / scale, my = 16 + (y - 16) / scale;
          const over = (alpha) => (c = c.map((v) => v + (255 - v) * alpha));
          if (inPolygon(mx, my, leftPage) || inPolygon(mx, my, rightPage)) over(0.95);
          if (nearPolyline(mx, my, arc, 0.9)) over(0.8);
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const o = (py * px + qx) * 4, n = S * S;
      // Average premultiplied colour, then un-premultiply.
      const alpha = a / n;
      data[o] = alpha ? Math.round(r / (a / 255)) : 0;
      data[o + 1] = alpha ? Math.round(g / (a / 255)) : 0;
      data[o + 2] = alpha ? Math.round(b / (a / 255)) : 0;
      data[o + 3] = Math.round(alpha);
    }
  }
  return data;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function png(px, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(px * (px * 4 + 1));
  for (let y = 0; y < px; y++) rgba.copy(raw, y * (px * 4 + 1) + 1, y * px * 4, (y + 1) * px * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  ['icon-192.png', 192, { radius: 9, scale: 1 }],
  ['icon-512.png', 512, { radius: 9, scale: 1 }],
  // Maskable: full bleed, motif inside the 80 % safe circle.
  ['icon-maskable-192.png', 192, { radius: 0, scale: 0.72 }],
  ['icon-maskable-512.png', 512, { radius: 0, scale: 0.72 }],
  // iOS rounds the corners itself and shows transparency as black.
  ['apple-touch-icon.png', 180, { radius: 0, scale: 0.9 }],
];
for (const [name, px, opts] of icons) writeFileSync(new URL(name, OUT), png(px, draw(px, opts)));
console.log(`wrote ${icons.length} icons to ${OUT.pathname}`);
