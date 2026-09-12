import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
writeIcons(path.join(dist, 'icons'));

const common = {
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: !watch,
  logLevel: 'info',
  banner: { js: 'globalThis.process=globalThis.process||{env:{}};' }
};

const options = {
  ...common,
  entryPoints: [path.join(root, 'src/content.jsx')],
  outfile: path.join(dist, 'content.js'),
  jsx: 'automatic',
  loader: { '.css': 'text' }
};

const bgOptions = {
  ...common,
  entryPoints: [path.join(root, 'src/background.js')],
  outfile: path.join(dist, 'background.js'),
  target: 'es2022'
};

function copy() {
  const files = [
    ['manifest.json', 'manifest.json'],
    ['src/page.js', 'page.js'],
    ['src/popup.html', 'popup.html'],
    ['src/popup.css', 'popup.css'],
    ['src/popup.js', 'popup.js']
  ];
  for (const [from, to] of files) fs.copyFileSync(path.join(root, from), path.join(dist, to));
}

copy();

if (watch) {
  const ctx = await esbuild.context(options);
  const ctxBg = await esbuild.context(bgOptions);
  await ctx.watch();
  await ctxBg.watch();
  fs.watch(path.join(root, 'src'), { recursive: true }, () => copy());
  console.log('watching…');
} else {
  await esbuild.build(options);
  await esbuild.build(bgOptions);
  copy();
}

/* --- tiny PNG writer for toolbar icons --- */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function icon(size) {
  const p = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = a;
  };
  const insideRoundRect = (x, y, x0, y0, w, h, rad) => {
    const cx = Math.min(Math.max(x, x0 + rad), x0 + w - rad);
    const cy = Math.min(Math.max(y, y0 + rad), y0 + h - rad);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  };
  const m = Math.round(size * 0.12);
  const rad = Math.round(size * 0.22);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRoundRect(x, y, m, m, size - 2 * m, size - 2 * m, rad)) set(x, y, 255, 0, 0);
    }
  }
  const cx = size * 0.42, cy = size * 0.5;
  const h = size * 0.32, w = size * 0.34;
  for (let y = 0; y < size; y++) {
    const t = (y - (cy - h / 2)) / h;
    if (t < 0 || t > 1) continue;
    const span = w * (1 - Math.abs(t - 0.5) * 2);
    for (let x = cx; x < cx + span; x++) set(x, y, 255, 255, 255);
  }
  return png(size, size, p);
}
function writeIcons(dir) {
  for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(dir, s + '.png'), icon(s));
}
