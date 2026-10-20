#!/usr/bin/env node

/**
 * snap.mjs -- Ad-hoc screenshot helper for NestSelf development.
 *
 * Usage:
 *   node e2e/snap.mjs <url> [options]
 *
 * Options:
 *   --out <dir>          Output directory (default: ./e2e/snaps)
 *   --name <base>        Base name for output files (default: snap)
 *   --palette <palette>  Theme palette: forest | ink | plum | azure
 *   --mode <mode>        Theme mode: light | dark
 *   --locale <locale>    Locale: en | sr-Latn | sr-Cyrl
 *   --viewport <type>    Viewport: mobile | desktop | both (default: both)
 *   --selector <css>     Screenshot only this CSS selector
 *   --no-full            Capture viewport only, not full page
 */

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: './e2e/snaps' },
    name: { type: 'string', default: 'snap' },
    palette: { type: 'string' },
    mode: { type: 'string' },
    locale: { type: 'string' },
    viewport: { type: 'string', default: 'both' },
    selector: { type: 'string' },
    full: { type: 'boolean', default: true },
  },
});

const url = positionals[0];
if (!url) {
  console.error('Usage: node e2e/snap.mjs <url> [--out <dir>] [--name <base>] ...');
  process.exit(1);
}

const outDir = resolve(values.out);
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const viewports = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

/** @param {'mobile' | 'desktop'} kind */
function shouldCapture(kind) {
  return values.viewport === 'both' || values.viewport === kind;
}

let exitCode = 0;

const browser = await chromium.launch();

try {
  for (const kind of /** @type {const} */ (['mobile', 'desktop'])) {
    if (!shouldCapture(kind)) continue;

    const vp = viewports[kind];
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      locale: 'en-GB',
      timezoneId: 'Europe/Belgrade',
      reducedMotion: 'reduce',
    });

    const page = await context.newPage();

    // Collect console errors
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Collect failed requests
    const failedRequests = [];
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText ?? 'unknown'}`);
    });

    // Apply theme via localStorage init script (runs before page scripts)
    if (values.palette || values.mode) {
      const theme = {
        palette: values.palette ?? 'forest',
        mode: values.mode ?? 'light',
        font: 'onest',
      };
      await page.addInitScript((t) => {
        localStorage.setItem('nestself-theme', JSON.stringify(t));
      }, theme);
    }

    // Apply locale via localStorage init script
    if (values.locale) {
      await page.addInitScript((l) => {
        localStorage.setItem('nestself-locale', l);
      }, values.locale);
    }

    // Navigate
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    const status = response?.status() ?? 0;

    if (status >= 400) {
      console.error(`[${kind}] HTTP ${status} for ${url}`);
      exitCode = 1;
    }

    // Wait for fonts and animation frames
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    // Take screenshot
    const filePath = resolve(outDir, `${values.name}-${kind}.png`);

    if (values.selector) {
      const locator = page.locator(values.selector);
      await locator.screenshot({ path: filePath });
    } else {
      await page.screenshot({ path: filePath, fullPage: values.full });
    }

    console.log(`Saved: ${filePath}`);

    // Report errors
    for (const err of consoleErrors) {
      console.error(`[${kind}] Console error: ${err}`);
      exitCode = 1;
    }

    for (const req of failedRequests) {
      console.error(`[${kind}] Failed request: ${req}`);
    }

    await context.close();
  }
} finally {
  await browser.close();
}

process.exit(exitCode);
