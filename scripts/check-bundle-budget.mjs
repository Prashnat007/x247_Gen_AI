#!/usr/bin/env node
/**
 * Bundle-size budget check.
 *
 * The Lighthouse-90 work depends on the SPA's first-paint payload staying
 * small. This script reads the production bundle from `dist/assets` and
 * fails CI when:
 *
 *   • the entry chunk (the one referenced by `index.html` as the
 *     module entry point) exceeds ENTRY_BUDGET_GZIP, or
 *   • any non-vendor app/page chunk exceeds CHUNK_BUDGET_GZIP.
 *
 * Vendor chunks (`vendor-*`) are exempt from the per-chunk cap because
 * they're shared across pages and the entry-cap already protects first
 * paint. They get their own larger ceiling via VENDOR_BUDGET_GZIP so a
 * runaway dependency can't sneak in unnoticed.
 *
 * Run via `npm run check:bundle-budget` after `npm run build`.
 */

import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const KB = 1024;
const ENTRY_BUDGET_GZIP = 250 * KB;       // 250 KB gzipped for the entry chunk
const CHUNK_BUDGET_GZIP = 200 * KB;       // 200 KB gzipped for any non-vendor chunk
const VENDOR_BUDGET_GZIP = 450 * KB;      // 450 KB gzipped for vendor chunks

const dist = path.resolve(process.cwd(), 'dist');
const assetsDir = path.join(dist, 'assets');
const indexHtmlPath = path.join(dist, 'index.html');

async function main() {
  let html;
  try {
    html = await fs.readFile(indexHtmlPath, 'utf8');
  } catch {
    console.error('check:bundle-budget — dist/index.html not found. Run `npm run build` first.');
    process.exit(2);
  }

  // Vite emits the entry as <script type="module" crossorigin src="/assets/index-XXXX.js">.
  // Pull every JS file referenced from index.html so the entry is always the first one
  // (Vite puts the entry script tag first in the head).
  const entryMatch = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+\/index-[^"']+\.js)["']/i);
  let entryFile = entryMatch?.[1];
  if (!entryFile) {
    // Fallback: find any /assets/index-*.js
    const entries = (await fs.readdir(assetsDir)).filter(f => /^index-.*\.js$/.test(f));
    if (entries.length === 1) entryFile = `/assets/${entries[0]}`;
  }
  if (!entryFile) {
    console.error('check:bundle-budget — could not locate the entry chunk.');
    process.exit(2);
  }
  const entryName = path.basename(entryFile);

  const files = (await fs.readdir(assetsDir)).filter(f => f.endsWith('.js'));
  const rows = [];
  for (const file of files) {
    const buf = await fs.readFile(path.join(assetsDir, file));
    const gz = gzipSync(buf).length;
    rows.push({ file, raw: buf.length, gz });
  }
  rows.sort((a, b) => b.gz - a.gz);

  let failed = false;
  console.log('\nchunk                                            raw       gzipped   budget');
  console.log('───────────────────────────────────────────────────────────────────────────');
  for (const r of rows) {
    const isEntry = r.file === entryName;
    const isVendor = r.file.startsWith('vendor-');
    const budget = isEntry ? ENTRY_BUDGET_GZIP : isVendor ? VENDOR_BUDGET_GZIP : CHUNK_BUDGET_GZIP;
    const tag = isEntry ? 'ENTRY' : isVendor ? 'VEND ' : 'CHUNK';
    const ok = r.gz <= budget;
    if (!ok) failed = true;
    const status = ok ? 'ok' : 'FAIL';
    console.log(
      `${tag} ${r.file.padEnd(40)} ${fmt(r.raw).padStart(8)}  ${fmt(r.gz).padStart(8)}  ${fmt(budget).padStart(7)} ${status}`
    );
  }

  console.log('───────────────────────────────────────────────────────────────────────────');
  console.log(`Entry budget:  ${fmt(ENTRY_BUDGET_GZIP)} gzip`);
  console.log(`Chunk budget:  ${fmt(CHUNK_BUDGET_GZIP)} gzip (non-vendor)`);
  console.log(`Vendor budget: ${fmt(VENDOR_BUDGET_GZIP)} gzip`);

  if (failed) {
    console.error('\nbundle budget violated — split the offending module or move it behind React.lazy.');
    process.exit(1);
  }
  console.log('\nbundle budget ok ✓');
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
