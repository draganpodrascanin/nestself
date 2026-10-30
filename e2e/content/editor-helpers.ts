/**
 * Helpers for the editor e2e journey (T-C1.12).
 *
 * Sign-in helpers live in ./helpers.ts. This file adds editor page objects
 * and read-only checks of what the API stored: the journey drives the UI
 * only, and verifies each step against the saved revision.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Screenshots (docs/cms-ee/manual/screenshots/<role>/<name>.png)
// ---------------------------------------------------------------------------

const SCREENSHOT_BASE = path.resolve(import.meta.dirname, '../../docs/cms-ee/manual/screenshots');

export function screenshotPath(role: string, name: string): string {
  const dir = path.join(SCREENSHOT_BASE, role);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
}

/** Wait until no animation is running, so a screenshot never catches a fade. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
}

/** A settled 1440×900 screenshot of the top of the page. */
export async function shoot(page: Page, role: string, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: screenshotPath(role, name) });
}

export const TEST_IMAGE_PATH = path.resolve(import.meta.dirname, '../fixtures/test-image.png');

// ---------------------------------------------------------------------------
// Editor page objects
// ---------------------------------------------------------------------------

export function editorBody(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Content editor' });
}

/** The editor page is loaded: heading and the editor body are present. */
export async function waitForEditorReady(page: Page): Promise<void> {
  await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });
  await editorBody(page).waitFor({ timeout: 10_000 });
}

/** The autosave status reads "Saved". */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 15_000 });
}

const DOC_END = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

/**
 * Put the caret in an empty paragraph at the end of the document. TrailingNode
 * keeps a paragraph after the last block; when that paragraph already has
 * text, Enter starts a new one.
 */
export async function caretToNewBlockAtEnd(page: Page): Promise<void> {
  const editor = editorBody(page);
  await editor.click();
  await page.keyboard.press(DOC_END);
  const lastText = await editor.evaluate((el) => el.lastElementChild?.textContent ?? '');
  if (lastText.trim() !== '') await page.keyboard.press('Enter');
}

export function slashMenu(page: Page): Locator {
  return page.getByRole('listbox');
}

/**
 * Insert a block through the slash menu at the end of the document: type
 * `/`, filter, check the first option is the expected block, press Enter.
 */
export async function slashInsert(page: Page, filter: string, option: RegExp): Promise<void> {
  await caretToNewBlockAtEnd(page);
  await page.keyboard.type('/');
  const menu = slashMenu(page);
  await expect(menu).toBeVisible();
  await page.keyboard.type(filter, { delay: 20 });
  const active = menu.getByRole('option', { selected: true });
  await expect(active).toHaveAccessibleName(option);
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
}

/** Select the last `chars` characters before the caret with the keyboard. */
export async function selectBackwards(page: Page, chars: number): Promise<void> {
  for (let i = 0; i < chars; i++) await page.keyboard.press('Shift+ArrowLeft');
}

// ---------------------------------------------------------------------------
// Read-only checks of the stored revision
// ---------------------------------------------------------------------------

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface StoredRevision {
  id: string;
  revisionNumber: number;
  state: string;
  title: string;
  summary: string;
  outcome: string | null;
  durationSeconds: number | null;
  sources: Array<{ label: string; url: string }> | null;
  proposedAudience: Array<{ kind: string }> | null;
  body: DocNode;
}

/**
 * The newest revision of a locale, read through the app's own `/api` proxy
 * with the signed-in user's session (GET only).
 */
export async function readRevision(
  page: Page,
  resourceId: string,
  locale: 'sr-Latn' | 'hu' | 'en',
): Promise<StoredRevision> {
  const res = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return { status: r.status, body: (await r.json()) as unknown };
  }, `/api/ops/cms/resources/${resourceId}`);
  expect(res.status, 'GET resource detail').toBe(200);
  const detail = res.body as {
    variants: Array<{ locale: string; revisions?: StoredRevision[] }>;
  };
  const variant = detail.variants.find((v) => v.locale === locale);
  expect(variant, `variant ${locale}`).toBeTruthy();
  const revisions = [...(variant!.revisions ?? [])].sort(
    (a, b) => b.revisionNumber - a.revisionNumber,
  );
  expect(revisions.length, `revisions of ${locale}`).toBeGreaterThan(0);
  return revisions[0]!;
}

/** Top-level block types, in order. */
export function blockTypes(doc: DocNode): string[] {
  return (doc.content ?? []).map((n) => n.type);
}

/** Every node in document order. */
export function allNodes(node: DocNode): DocNode[] {
  return [node, ...(node.content ?? []).flatMap(allNodes)];
}

export function textOf(node: DocNode): string {
  return allNodes(node)
    .map((n) => n.text ?? '')
    .join('');
}

/** The first top-level block of a type whose text contains `text`. */
export function findBlock(doc: DocNode, type: string, text?: string): DocNode | undefined {
  return (doc.content ?? []).find(
    (n) => n.type === type && (text === undefined || textOf(n).includes(text)),
  );
}
