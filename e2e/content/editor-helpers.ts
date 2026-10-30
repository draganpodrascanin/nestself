/**
 * Helpers specific to the editor e2e journey (T-C1.12).
 *
 * Sign-in helpers live in ./helpers.ts; this file adds page-object
 * utilities for the CMS editor, slash menu, bubble menu and block handle.
 */
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Screenshot helper (writes to docs/cms-ee/manual/screenshots/)
// ---------------------------------------------------------------------------

const SCREENSHOT_BASE = path.resolve(
  import.meta.dirname,
  '../../docs/cms-ee/manual/screenshots',
);

export function screenshotDir(role: string): string {
  const dir = path.join(SCREENSHOT_BASE, role);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function screenshotPath(role: string, name: string): string {
  return path.join(screenshotDir(role), `${name}.png`);
}

// ---------------------------------------------------------------------------
// Editor page-object helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the editor page to be ready (heading visible + editor loaded).
 * The heading is "Edit variant" (i18n key cms:editor.title).
 */
export async function waitForEditorReady(page: Page): Promise<void> {
  await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });
  // Wait for the editor textbox to be present
  await page.getByRole('textbox', { name: /content editor/i }).waitFor({ timeout: 10_000 });
}

/**
 * Type text into the editor body area.
 */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.getByRole('textbox', { name: /content editor/i });
  await editor.click();
  await editor.pressSequentially(text, { delay: 20 });
}

/**
 * Open the slash menu by typing `/` and then filter + select.
 * @param filter - text to type after `/` to filter the menu
 */
export async function slashMenuInsert(page: Page, filter: string): Promise<void> {
  const editor = page.getByRole('textbox', { name: /content editor/i });
  await editor.press('Enter');
  await editor.pressSequentially('/', { delay: 30 });
  // Wait for the slash menu popup to appear
  await page.locator('[role="listbox"]').first().waitFor({ timeout: 5_000 });
  // Type filter text
  if (filter) {
    await page.keyboard.type(filter, { delay: 30 });
  }
  // Small delay for filtering
  await page.waitForTimeout(200);
  // Press Enter to select the first match
  await page.keyboard.press('Enter');
  // Wait for menu to close
  await page.waitForTimeout(300);
}

/**
 * Use a markdown shortcut at the beginning of a new line.
 * Assumes cursor is already in the editor. Presses Enter first to start a new line.
 */
export async function markdownShortcut(page: Page, prefix: string, text: string): Promise<void> {
  const editor = page.getByRole('textbox', { name: /content editor/i });
  await editor.press('Enter');
  await editor.pressSequentially(prefix, { delay: 20 });
  // The shortcut triggers on Space after the prefix (e.g., "## ")
  // The prefix string already ends with a space, so the conversion should happen
  await page.waitForTimeout(200);
  await editor.pressSequentially(text, { delay: 20 });
}

/**
 * Select text in the editor (by triple-clicking the current paragraph
 * or by keyboard selection).
 */
export async function selectCurrentLine(page: Page): Promise<void> {
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

/**
 * Wait for autosave status to show "Saved".
 */
export async function waitForSaved(page: Page): Promise<void> {
  await page.getByText(/^saved$/i).waitFor({ timeout: 15_000 });
}

/**
 * Fixture path for test images.
 */
export const TEST_IMAGE_PATH = path.resolve(
  import.meta.dirname,
  '../fixtures/test-image.png',
);
