// Renders a Markdown guide to PDF with Playwright's bundled Chromium.
// Pagination is automatic (CSS print styles, A4, running footer with page numbers),
// unlike docs/tasks/auth/pdf/build-pdf.mjs which paginates a designed HTML by hand.
//
// Usage:
//   node docs/auth/pdf/build.mjs docs/auth/implementation.md docs/auth/implementation.pdf
//   node docs/auth/pdf/build.mjs docs/auth/quick-guide.md docs/auth/quick-guide.pdf --html out.html
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const [input, output] = positional;
const htmlOut = argv.includes('--html') ? argv[argv.indexOf('--html') + 1] : null;
if (!input || !output) {
  console.error('usage: node build.mjs <input.md> <output.pdf> [--html <out.html>]');
  process.exit(1);
}

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** Resolve a package from pnpm's virtual store without declaring it at the root. */
function storePackage(name) {
  const store = resolve(repoRoot, 'node_modules', '.pnpm');
  const dir = readdirSync(store).find((d) => d.startsWith(`${name}@`) && !d.includes('micromark-extension-gfm-'));
  if (!dir) throw new Error(`${name} not found in the pnpm store`);
  return pathToFileURL(resolve(store, dir, 'node_modules', name, 'index.js')).href;
}
const { micromark } = await import(storePackage('micromark'));
const { gfm, gfmHtml } = await import(storePackage('micromark-extension-gfm'));

const markdown = readFileSync(resolve(input), 'utf8');
const title = (markdown.match(/^#\s+(.+)$/m) ?? [, 'NestSelf'])[1];
let body = micromark(markdown, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] });
// Heading ids for the table of contents links.
body = body.replace(/<h([1-4])>([^<]+)<\/h\1>/g, (_, level, text) => {
  const id = text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `<h${level} id="${id}">${text}</h${level}>`;
});

const css = readFileSync(resolve(repoRoot, 'docs/auth/pdf/styles.css'), 'utf8');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<base href="${pathToFileURL(resolve(repoRoot, 'docs/auth/pdf/')).href}">
<style>${css}</style></head>
<body><main class="doc">${body}</main></body></html>`;
if (htmlOut) writeFileSync(resolve(htmlOut), html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: resolve(output),
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:Onest,system-ui,sans-serif;font-size:8pt;color:#4E655A;padding:0 16mm;display:flex;justify-content:space-between;">
      <span>NestSelf · ${title.replace(/"/g, '&quot;')}</span><span class="pageNumber"></span></div>`,
  });
  console.log(`wrote ${output}`);
} finally {
  await browser.close();
}
