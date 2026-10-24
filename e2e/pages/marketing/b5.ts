import { MARKETING_URL } from '../../ports';
import type { Page } from '@playwright/test';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-tools', url: `${MARKETING_URL}/tools`, locale: 'sr-Latn' },
  { name: 'marketing-tools-en', url: `${MARKETING_URL}/en/tools` },
  { name: 'marketing-tools-hu', url: `${MARKETING_URL}/hu/tools`, locale: 'hu' },
  { name: 'marketing-tools-sr-cyrl', url: `${MARKETING_URL}/sr-Cyrl/tools`, locale: 'sr-Cyrl' },
  { name: 'marketing-wellbeing-check-in', url: `${MARKETING_URL}/tools/wellbeing-check-in`, locale: 'sr-Latn' },
  { name: 'marketing-wellbeing-check-in-en', url: `${MARKETING_URL}/en/tools/wellbeing-check-in` },
  { name: 'marketing-wellbeing-check-in-result', url: `${MARKETING_URL}/tools/wellbeing-check-in`, locale: 'sr-Latn', prepare: 'completeWellbeingCheckIn' },
  { name: 'marketing-anxiety-check', url: `${MARKETING_URL}/tools/anxiety-check`, locale: 'sr-Latn' },
  { name: 'marketing-conversation-planner', url: `${MARKETING_URL}/tools/conversation-planner`, locale: 'sr-Latn' },
];

/**
 * Prepare action that completes the wellbeing check-in assessment.
 * Selects "Često" for every question and submits (Serbian Latin labels).
 */
async function completeWellbeingCheckIn(page: Page): Promise<void> {
  // Click "Započnite" (Start)
  await page.getByRole('button', { name: 'Započnite' }).click();

  // There are 8 questions; for each, select "Često" (Often) and click Sledeće (Next) or Pogledajte rezultat (See your result)
  for (let i = 0; i < 8; i++) {
    await page.getByRole('radio', { name: 'Često' }).click();
    const isLast = i === 7;
    if (isLast) {
      await page.getByRole('button', { name: 'Pogledajte rezultat' }).click();
    } else {
      await page.getByRole('button', { name: 'Sledeće' }).click();
    }
  }

  // Wait for result heading to be visible
  await page.getByRole('heading', { name: 'Vaš rezultat' }).waitFor({ state: 'visible' });
}

export const prepareActions: Record<string, (page: Page) => Promise<void>> = {
  completeWellbeingCheckIn,
};
