/**
 * Shared helpers for the guide screenshots (`pnpm docs:auth:screenshots`).
 *
 * Every PNG lands in docs/auth/screenshots/ at the viewport size of the
 * `screenshots` project (1280x800, light, deviceScaleFactor 1, reduced
 * motion). Only the fictional sample people of packages/sample-data appear.
 */
import * as path from 'node:path';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const WORKSPACE_URL = 'http://localhost:5173';
export const ADMIN_URL = 'http://localhost:5174';

const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '..', '..', 'docs', 'auth', 'screenshots');

/** Waits for fonts and a quiet frame, then writes `<name>.png` (viewport only). */
export async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Let toasts, focus rings and popovers settle; animations are reduced.
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  });
}

/** Opens a select (inside a dialog or a region) and picks an option; the popup is portalled. */
export async function pick(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  const combobox = scope.getByRole('combobox', { name: label });
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(combobox).toHaveText(option);
}
