import type { Page } from '@playwright/test';
import { appPrepareActions } from './pages';

/** Theme shape stored under `nestself-theme` in localStorage. */
export interface ThemeConfig {
  palette: 'forest' | 'ink' | 'plum' | 'azure';
  mode: 'light' | 'dark';
  font: 'onest';
}

/**
 * Inject a theme into localStorage before any page script runs.
 * Must be called before `page.goto`.
 */
export async function applyTheme(
  page: Page,
  theme: { palette: ThemeConfig['palette']; mode: ThemeConfig['mode'] },
): Promise<void> {
  const config: ThemeConfig = { ...theme, font: 'onest' };
  await page.addInitScript((t: ThemeConfig) => {
    localStorage.setItem('nestself-theme', JSON.stringify(t));
  }, config);
}

/**
 * Inject a locale preference into localStorage before any page script runs.
 * Must be called before `page.goto`.
 */
export async function applyLocale(
  page: Page,
  locale: 'en' | 'sr-Latn' | 'sr-Cyrl' | 'hu',
): Promise<void> {
  await page.addInitScript((l: string) => {
    localStorage.setItem('nestself-locale', l);
  }, locale);
}

/**
 * Wait until the page has settled: network idle, fonts loaded,
 * and two animation frames completed.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/**
 * Collects console errors emitted on the page.
 * Call early (before navigation); read the returned array after the page is loaded.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

/**
 * Scroll through the entire page in viewport-height increments so lazy-loaded
 * images below the fold finish loading, then scroll back to the top.
 */
export async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Lazy images never load if the capture engine does not scroll, so load them all now.
    for (const img of document.images) {
      if (img.loading === 'lazy') img.loading = 'eager';
    }
    const step = window.innerHeight;
    const maxScroll = document.documentElement.scrollHeight;
    for (let y = 0; y < maxScroll; y += step) {
      window.scrollTo(0, y);
      await new Promise<void>((r) => setTimeout(r, 40));
    }
    const deadline = Date.now() + 10_000;
    const pending = [...document.images].filter((img) => !img.complete);
    await Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((r) => {
            const done = () => r();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            setTimeout(done, Math.max(0, deadline - Date.now()));
          }),
      ),
    );
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
    window.scrollTo(0, 0);
  });
  await settle(page);
}

/**
 * Named preparation actions keyed by the `prepare` field on a PageEntry.
 * Each action receives the current Page and performs interactions
 * (e.g. clicking through a multi-step demo) before the screenshot is taken.
 */
export const prepareActions: Record<string, (page: Page) => Promise<void>> = {
  ...appPrepareActions,
};
