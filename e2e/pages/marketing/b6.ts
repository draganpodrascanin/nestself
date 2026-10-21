import type { Page } from '@playwright/test';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-demo', url: 'http://localhost:3000/en/demo' },
  { name: 'marketing-demo-error', url: 'http://localhost:3000/en/demo', prepare: 'b6-demo-error' },
  { name: 'marketing-demo-hu', url: 'http://localhost:3000/hu/demo', locale: 'hu' },
  { name: 'marketing-contact', url: 'http://localhost:3000/en/contact' },
  { name: 'marketing-contact-error', url: 'http://localhost:3000/en/contact', prepare: 'b6-contact-error' },
  { name: 'marketing-privacy-model', url: 'http://localhost:3000/en/privacy-model' },
  { name: 'marketing-legal-privacy-policy', url: 'http://localhost:3000/en/legal/privacy-policy' },
  { name: 'marketing-legal-terms', url: 'http://localhost:3000/en/legal/terms' },
  { name: 'marketing-legal-cookies', url: 'http://localhost:3000/en/legal/cookies' },
  { name: 'marketing-legal-imprint', url: 'http://localhost:3000/en/legal/imprint' },
  { name: 'marketing-accessibility', url: 'http://localhost:3000/en/accessibility' },
  { name: 'marketing-credits', url: 'http://localhost:3000/en/credits' },
];

export const prepareActions: Record<string, (page: Page) => Promise<void>> = {
  'b6-demo-error': async (page) => {
    await page.click('button[type="submit"]');
    await page.waitForSelector('[role="alert"]');
  },
  'b6-contact-error': async (page) => {
    await page.click('button[type="submit"]');
    await page.waitForSelector('[role="alert"]');
  },
};
