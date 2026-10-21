import type { Page } from '@playwright/test';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-tools', url: 'http://localhost:3000/en/tools' },
  { name: 'marketing-tools-hu', url: 'http://localhost:3000/hu/tools', locale: 'hu' },
  { name: 'marketing-tools-sr-cyrl', url: 'http://localhost:3000/sr-Cyrl/tools', locale: 'sr-Cyrl' },
  { name: 'marketing-wellbeing-check-in', url: 'http://localhost:3000/en/tools/wellbeing-check-in' },
  { name: 'marketing-wellbeing-check-in-result', url: 'http://localhost:3000/en/tools/wellbeing-check-in', prepare: 'completeWellbeingCheckIn' },
  { name: 'marketing-anxiety-check', url: 'http://localhost:3000/en/tools/anxiety-check' },
  { name: 'marketing-conversation-planner', url: 'http://localhost:3000/en/tools/conversation-planner' },
];

/**
 * Prepare action that completes the wellbeing check-in assessment.
 * Selects "Often" for every question and submits.
 */
async function completeWellbeingCheckIn(page: Page): Promise<void> {
  // Click "Start"
  await page.getByRole('button', { name: 'Start' }).click();

  // There are 8 questions; for each, select "Often" and click Next (or "See your result" for the last)
  for (let i = 0; i < 8; i++) {
    await page.getByRole('radio', { name: 'Often' }).click();
    const isLast = i === 7;
    if (isLast) {
      await page.getByRole('button', { name: 'See your result' }).click();
    } else {
      await page.getByRole('button', { name: 'Next' }).click();
    }
  }

  // Wait for result heading to be visible
  await page.getByRole('heading', { name: 'Your result' }).waitFor({ state: 'visible' });
}

export const prepareActions: Record<string, (page: Page) => Promise<void>> = {
  completeWellbeingCheckIn,
};
