#!/usr/bin/env node
//
// Re-renders public/deck/index.html to a downloadable A4-landscape PDF
// at public/deck/recall-x247-deck.pdf, using the deck's existing
// @media print stylesheet.
//
// Usage:    npm run export:deck-pdf
// Override: DECK_URL=http://localhost:5000/deck/index.html npm run export:deck-pdf
//
// Prerequisite — a Playwright Chromium binary must be available. The script
// resolves it (in order) from:
//   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE  (explicit override)
//   2. REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE  (preinstalled in Replit envs)
//   3. Playwright's default browsers cache  (install with `npm run test:e2e:install`)
//
// In CI, run `npx playwright install chromium` before this script.
//
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const DECK_HTML = path.join(ROOT, 'public', 'deck', 'index.html');
const OUTPUT_PDF = path.join(ROOT, 'public', 'deck', 'recall-x247-deck.pdf');

const SOURCE_URL = process.env.DECK_URL ?? `file://${DECK_HTML}`;

if (!fs.existsSync(DECK_HTML)) {
  console.error(`Deck HTML not found at ${DECK_HTML}`);
  process.exit(1);
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? undefined;

console.log(`Rendering deck → PDF`);
console.log(`  source : ${SOURCE_URL}`);
console.log(`  output : ${OUTPUT_PDF}`);
if (executablePath) console.log(`  chrome : ${executablePath}`);

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const context = await browser.newContext({
    viewport: { width: 1123, height: 794 },
  });
  const page = await context.newPage();

  await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 60_000 });

  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });

  await page.emulateMedia({ media: 'print' });

  await page.pdf({
    path: OUTPUT_PDF,
    width: '297mm',
    height: '210mm',
    landscape: false,
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });

  const bytes = fs.statSync(OUTPUT_PDF).size;
  console.log(`Wrote ${OUTPUT_PDF} (${(bytes / 1024).toFixed(1)} KB)`);
} finally {
  await browser.close();
}
