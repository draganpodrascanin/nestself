import type { Page } from '@playwright/test';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-demo', url: 'http://localhost:3000/demo', locale: 'sr-Latn' },
  { name: 'marketing-demo-en', url: 'http://localhost:3000/en/demo' },
  { name: 'marketing-demo-error', url: 'http://localhost:3000/demo', locale: 'sr-Latn', prepare: 'b6-demo-error' },
  { name: 'marketing-demo-hu', url: 'http://localhost:3000/hu/demo', locale: 'hu' },
  { name: 'marketing-contact', url: 'http://localhost:3000/contact', locale: 'sr-Latn' },
  { name: 'marketing-contact-en', url: 'http://localhost:3000/en/contact' },
  { name: 'marketing-contact-error', url: 'http://localhost:3000/contact', locale: 'sr-Latn', prepare: 'b6-contact-error' },
  { name: 'marketing-privacy-model', url: 'http://localhost:3000/privacy-model', locale: 'sr-Latn' },
  { name: 'marketing-legal-privacy-policy', url: 'http://localhost:3000/legal/privacy-policy', locale: 'sr-Latn' },
  { name: 'marketing-legal-terms', url: 'http://localhost:3000/legal/terms', locale: 'sr-Latn' },
  { name: 'marketing-legal-cookies', url: 'http://localhost:3000/legal/cookies', locale: 'sr-Latn' },
  { name: 'marketing-legal-imprint', url: 'http://localhost:3000/legal/imprint', locale: 'sr-Latn' },
  { name: 'marketing-accessibility', url: 'http://localhost:3000/accessibility', locale: 'sr-Latn' },
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
