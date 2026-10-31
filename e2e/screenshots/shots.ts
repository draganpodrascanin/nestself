/**
 * Shared helpers for the guide screenshots (`pnpm docs:auth:screenshots`).
 *
 * Every PNG lands in docs/auth/screenshots/ at the viewport size of the
 * `screenshots` project (1280x800, light, deviceScaleFactor 1, reduced
 * motion); a capture that needs more height sets its own viewport and says
 * why. Only the fictional sample people of packages/sample-data appear, and
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
 * Waits for fonts and a quiet frame, then writes `<name>.png` (viewport only).
 * Fails when the page shows the real developer account (fictional people only;
 * the shot files call `removeDeveloperAccount()` first).
 */
export async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Let toasts, focus rings and popovers settle; animations are reduced.
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text, `${name}: the real developer account is on screen`).not.toMatch(REAL_PERSON);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  });
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
