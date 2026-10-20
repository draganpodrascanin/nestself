import type { Page } from '@playwright/test';
import { adminPages } from './pages/admin';
import { marketingPages } from './pages/marketing';
import { workspacePages, workspacePrepareActions } from './pages/workspace';

export interface PageEntry {
  name: string;
  url: string;
  theme?: { palette: 'forest' | 'ink' | 'plum' | 'azure'; mode: 'light' | 'dark' };
  locale?: 'en' | 'sr-Latn' | 'sr-Cyrl';
  /** Name of an action in `appPrepareActions` run after navigation (e.g. click through to a step). */
  prepare?: string;
}

/** Every page the screenshot, a11y and reflow specs cover. Each app registers its routes in e2e/pages/<app>.ts. */
export const pages: PageEntry[] = [...marketingPages, ...workspacePages, ...adminPages];

/** Prepare actions contributed by the apps, merged into helpers.prepareActions. */
export const appPrepareActions: Record<string, (page: Page) => Promise<void>> = {
  ...workspacePrepareActions,
};
