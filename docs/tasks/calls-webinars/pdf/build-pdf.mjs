// Renders the designed overview (an HTML file paginated into fixed A4 `.page` sections) to PDF
// with Playwright's bundled Chromium, and fails when any page overflows its fixed height.
//
// Usage:
//   node docs/tasks/auth/pdf/build-pdf.mjs <input.html> <output.pdf> [--png <dir>] [--allow-overflow]
//
// --png <dir> also writes one PNG per page (element screenshots at 2x) for visual review.
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const [input, output] = positional;
const pngDir = argv.includes('--png') ? argv[argv.indexOf('--png') + 1] : null;
const allowOverflow = argv.includes('--allow-overflow');
if (!input || !output) {
  console.error('usage: node build-pdf.mjs <input.html> <output.pdf> [--png <dir>] [--allow-overflow]');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.__paginated === true, null, { timeout: 60000 });
  await page.emulateMedia({ media: "print" });

  // Overflow check: every .page is a fixed 297 mm box; content taller than that would be clipped in print.
  const report = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.page')).map((el, i) => ({
      index: i + 1,
      id: el.id || null,
      overflow: Math.max(0, el.scrollHeight - el.clientHeight),
      widthOverflow: Math.max(0, el.scrollWidth - el.clientWidth),
    })),
  );
  const bad = report.filter((r) => r.overflow > 1 || r.widthOverflow > 1);
  for (const r of bad) console.error(`page ${r.index}${r.id ? ` (#${r.id})` : ''} overflows by ${r.overflow}px (width ${r.widthOverflow}px)`);
  console.log(`${report.length} pages checked, ${bad.length} overflowing`);

  if (pngDir) {
    mkdirSync(pngDir, { recursive: true });
    const pages = page.locator('.page');
    const n = await pages.count();
    for (let i = 0; i < n; i++) {
      await pages.nth(i).screenshot({ path: join(pngDir, `page-${String(i + 1).padStart(2, '0')}.png`) });
    }
    console.log(`wrote ${n} page previews to ${pngDir}`);
  }

  if (bad.length && !allowOverflow) {
    console.error('refusing to write the PDF with overflowing pages (pass --allow-overflow to force)');
    process.exit(2);
  }

  await page.pdf({
    path: resolve(output),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  console.log(`wrote ${output}`);
} finally {
  await browser.close();
}
