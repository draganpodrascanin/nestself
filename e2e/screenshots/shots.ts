/**
 * Shared helpers for the guide screenshots (`pnpm docs:auth:screenshots`).
 *
 * Every PNG lands in docs/auth/screenshots/: `shot()` writes the viewport of
 * the `screenshots` project (1280x800, light, deviceScaleFactor 1, reduced
 * motion), `shotOf()` an element cropped from it for the user guides (the
 * `guide-*.png`); a capture that needs more height sets its own viewport and
 * says why. Only the fictional sample people of packages/sample-data appear, and
 * no capture shows a token, code, nonce or secret: where a screen displays
 * one (an authenticator key, a single-use test link, a DNS verification
 * token), the shot masks it first (`maskText`) and the guide's caption says so.
 */
import * as path from 'node:path';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const WORKSPACE_URL = 'http://localhost:5173';
export const ADMIN_URL = 'http://localhost:5174';

const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '..', '..', 'docs', 'auth', 'screenshots');

/** Text that must never appear in a guide screenshot: the real developer account in `SAMPLE_PEOPLE`. */
const REAL_PERSON = /Dragan|Podra[sš][cć]anin|user_dragan/i;

/**
 * Waits for fonts and a quiet frame, and fails when the page shows the real
 * developer account (fictional people only; the shot files call
 * `removeDeveloperAccount()` first).
 */
async function settle(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Let toasts, focus rings and popovers settle; animations are reduced.
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text, `${name}: the real developer account is on screen`).not.toMatch(REAL_PERSON);
}

/** Writes `<name>.png` of the viewport, after `settle`. */
export async function shot(page: Page, name: string): Promise<void> {
  await settle(page, name);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  });
}

/** Options of `shotOf`. */
export interface ShotOfOptions {
  /** Pixels kept around the element, within the viewport (default 16). */
  margin?: number;
  /** Caps the crop from its left edge: a panel whose content is narrower than its box. */
  maxWidth?: number;
  /** Caps the crop from its top edge: a panel that ends in a long list. */
  maxHeight?: number;
}

/**
 * Writes `<name>.png` of one element, or of the box around several, plus a
 * margin clamped to the viewport, after the same `settle` as `shot()`. The
 * user guides (docs/auth/guides/) picture dialogs, forms, panels, menus and
 * sign-in cards this way, so their labels stay legible on an A4 page; scroll
 * the element into the viewport first.
 */
export async function shotOf(
  page: Page,
  target: Locator | Locator[],
  name: string,
  { margin = 16, maxWidth, maxHeight }: ShotOfOptions = {},
): Promise<void> {
  await settle(page, name);
  const boxes = [];
  for (const locator of Array.isArray(target) ? target : [target]) {
    const box = await locator.boundingBox();
    expect(box, `${name}: an element to crop is not on the page`).not.toBeNull();
    boxes.push(box!);
  }
  const viewport = page.viewportSize()!;
  const x = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.x)) - margin));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.y)) - margin));
  let right = Math.min(viewport.width, Math.ceil(Math.max(...boxes.map((b) => b.x + b.width)) + margin));
  let bottom = Math.min(viewport.height, Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)) + margin));
  if (maxWidth) right = Math.min(right, x + maxWidth);
  if (maxHeight) bottom = Math.min(bottom, y + maxHeight);
  expect(right > x && bottom > y, `${name}: the element to crop is outside the viewport`).toBe(true);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    clip: { x, y, width: right - x, height: bottom - y },
    animations: 'disabled',
    caret: 'hide',
  });
}

/** The card of the public sign-in layout (both apps) and the brand line above it, for `shotOf`. */
export function signInCard(page: Page): Locator[] {
  const card = page.locator('xpath=//div[contains(concat(" ", normalize-space(@class), " "), " sm:rounded-card ")]');
  return [card.locator('xpath=preceding-sibling::div[1]'), card];
}

/** What a masked secret shows instead in a guide screenshot. */
export const MASK = '••••••••';

/**
 * Replaces every match of `pattern` in the text under `scope` (in the page,
 * not in the app's state) before a capture, so a secret the screen displays
 * stays out of the PNG. Use a pattern with the `g` flag; `$1` and the like
 * work as in `String.prototype.replace`.
 */
export async function maskText(scope: Locator, pattern: RegExp, replacement: string): Promise<void> {
  const masked = await scope.evaluate(
    (root, { source, flags, replacement: with_ }) => {
      const regex = new RegExp(source, flags);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let count = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue ?? '';
        const next = text.replace(regex, with_);
        if (next !== text) {
          node.nodeValue = next;
          count += 1;
        }
      }
      return count;
    },
    { source: pattern.source, flags: pattern.flags, replacement },
  );
  expect(masked, `maskText: nothing matched ${String(pattern)}`).toBeGreaterThan(0);
}

/** Opens a select (inside a dialog or a region) and picks an option; the popup is portalled. */
export async function pick(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  const combobox = scope.getByRole('combobox', { name: label });
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(combobox).toHaveText(option);
}
