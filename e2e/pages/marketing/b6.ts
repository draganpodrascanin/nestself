import { MARKETING_URL } from '../../ports';
import type { Page } from '@playwright/test';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-demo', url: `${MARKETING_URL}/demo`, locale: 'sr-Latn' },
  { name: 'marketing-demo-en', url: `${MARKETING_URL}/en/demo` },
  { name: 'marketing-demo-error', url: `${MARKETING_URL}/demo`, locale: 'sr-Latn', prepare: 'b6-demo-error' },
  { name: 'marketing-demo-hu', url: `${MARKETING_URL}/hu/demo`, locale: 'hu' },
  { name: 'marketing-contact', url: `${MARKETING_URL}/contact`, locale: 'sr-Latn' },
  { name: 'marketing-contact-en', url: `${MARKETING_URL}/en/contact` },
  { name: 'marketing-contact-error', url: `${MARKETING_URL}/contact`, locale: 'sr-Latn', prepare: 'b6-contact-error' },
  { name: 'marketing-privacy-model', url: `${MARKETING_URL}/privacy-model`, locale: 'sr-Latn' },
  { name: 'marketing-legal-privacy-policy', url: `${MARKETING_URL}/legal/privacy-policy`, locale: 'sr-Latn' },
  { name: 'marketing-legal-terms', url: `${MARKETING_URL}/legal/terms`, locale: 'sr-Latn' },
  { name: 'marketing-legal-cookies', url: `${MARKETING_URL}/legal/cookies`, locale: 'sr-Latn' },
  { name: 'marketing-legal-imprint', url: `${MARKETING_URL}/legal/imprint`, locale: 'sr-Latn' },
  { name: 'marketing-accessibility', url: `${MARKETING_URL}/accessibility`, locale: 'sr-Latn' },
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
