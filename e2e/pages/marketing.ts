import type { Page } from '@playwright/test';
import type { PageEntry } from '../pages';
import { pages as b1Pages } from './marketing/b1';
import { pages as b2Pages } from './marketing/b2';
import { pages as b3Pages } from './marketing/b3';
import { pages as b4Pages } from './marketing/b4';
import { pages as b5Pages, prepareActions as b5PrepareActions } from './marketing/b5';
import { pages as b6Pages, prepareActions as b6PrepareActions } from './marketing/b6';

/** Every marketing route the screenshot, a11y and reflow specs cover; each page group keeps its own fragment. */
export const marketingPages: PageEntry[] = [
  ...b1Pages,
  ...b2Pages,
  ...b3Pages,
  ...b4Pages,
  ...b5Pages,
  ...b6Pages,
];

export const marketingPrepareActions: Record<string, (page: Page) => Promise<void>> = {
  ...b5PrepareActions,
  ...b6PrepareActions,
};
