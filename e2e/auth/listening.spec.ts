/**
 * Employee listening journeys (workspace; spec SUR-02, SUR-03, FBK-01, FBK-02,
 * section 11 keyboard and 390 px).
 *
 * Ivana (survey administrator, email code) opens a survey cycle now at
 * `/listening/surveys`; Jovan (employee, email code, his own browser context)
 * reaches the survey radios with Tab, answers the first question with Space,
 * skips the rest and sees the receipt; then he raises a problem at
 * `/feedback/new` through the alternative recipient and sees the case
 * pseudonym. A phone-width check opens the listening screens at 390 px and
 * asserts that nothing scrolls horizontally.
 *
 * Re-runs: global setup reseeds the e2e database, so no cycle is open at the
 * start; the second cycle of a run would be refused as overlapping, which the
 * journey tolerates by reusing the open one.
 *
 * Labels come from packages/i18n/locales/en/listening.json.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WORKSPACE_URL, signInWithEmailCode } from './support';

const HR_EMAIL = 'user_ivana@example.com';
const EMPLOYEE_EMAIL = 'user_jovan@example.com';
const ALTERNATE_RECIPIENT = 'Ivana Jovanović';

/** Presses Tab until the focused element is a radio of the given group (or gives up). */
async function tabToRadioGroup(page: Page, groupName: string): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    const inGroup = await page.evaluate((name) => {
      const active = document.activeElement;
      if (!active || active.getAttribute('role') !== 'radio') return false;
      const group = active.closest('[role="radiogroup"]');
      return !!group && (group.getAttribute('aria-label') === name || group.getAttribute('aria-labelledby') !== null);
    }, groupName);
    if (inGroup) return;
  }
  throw new Error(`no radio of "${groupName}" reached with Tab`);
}

async function openCycleNow(page: Page): Promise<void> {
  await page.goto(`${WORKSPACE_URL}/listening/surveys`);
  await expect(page.getByRole('heading', { level: 1, name: 'Surveys' })).toBeVisible({ timeout: 15_000 });
  // A cycle already open in this run (a retry): nothing to schedule.
  if ((await page.getByRole('table').getByText('Open', { exact: true }).count()) > 0) return;
  await page.getByRole('button', { name: 'Schedule a cycle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule a survey cycle' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open it now' }).click();
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('Open', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Employee listening', () => {
  test('the administrator opens a cycle; the employee answers by keyboard, sees the receipt and raises feedback through the alternative recipient', async ({ page, browser }) => {
    await signInWithEmailCode(page, WORKSPACE_URL, HR_EMAIL);
    await openCycleNow(page);
    // The administrator never sees participants: the cycles screen names a count, not people.
    await expect(page.getByText(/active members would be invited today/)).toBeVisible();

    const employee = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Belgrade' });
    const jovan = await employee.newPage();
    try {
      await signInWithEmailCode(jovan, WORKSPACE_URL, EMPLOYEE_EMAIL);
      await jovan.goto(`${WORKSPACE_URL}/survey`);
      await expect(jovan.getByRole('heading', { name: 'Before you start' })).toBeVisible({ timeout: 15_000 });
      await expect(jovan.getByText(/Your employer sees only aggregate results/)).toBeVisible();
      await jovan.getByRole('button', { name: 'Start the survey' }).click();
      await expect(jovan.getByText('Question 1 of 5')).toBeVisible();

      // Keyboard: the scale is reachable with Tab and the focused rating is chosen with Space.
      const scale = jovan.getByRole('radiogroup', { name: 'Rate from 1 to 5' });
      await expect(scale).toBeVisible();
      await tabToRadioGroup(jovan, 'Rate from 1 to 5');
      await jovan.keyboard.press('Space');
      await expect(scale.getByRole('radio', { checked: true })).toHaveCount(1);
      await expect(jovan.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

      await jovan.getByRole('button', { name: 'Next' }).click();
      for (let i = 0; i < 4; i += 1) {
        await jovan.getByRole('button', { name: 'Skip this question' }).click();
      }
      await expect(jovan.getByRole('heading', { name: 'Review your answers' })).toBeVisible();
      await expect(jovan.getByText('1 of 5 answered')).toBeVisible();
      await jovan.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(jovan.getByRole('heading', { name: 'Thank you' })).toBeVisible({ timeout: 15_000 });
      await expect(jovan.getByText(/They are counted once and cannot be changed/)).toBeVisible();

      // Feedback through the alternative recipient: the designated one is told nothing.
      await jovan.getByRole('link', { name: 'Share feedback separately' }).click();
      await expect(jovan.getByRole('heading', { level: 1, name: 'Raise a problem or suggestion' })).toBeVisible({ timeout: 15_000 });
      await jovan.getByRole('radio', { name: `${ALTERNATE_RECIPIENT} (alternative recipient, if the matter concerns the designated one)` }).click();
      await expect(jovan.getByTestId('recipient-preview')).toContainText(`Your report goes to ${ALTERNATE_RECIPIENT}`);
      await expect(jovan.getByTestId('recipient-preview')).toContainText('will not be told you chose the alternative');
      await jovan.getByRole('combobox', { name: 'Category' }).click();
      await jovan.getByRole('option', { name: 'Workload', exact: true }).click();
      await jovan.getByLabel(/^What happened, or what would help\?/).fill('The rota changes without notice and nobody tells us.');
      await expect(jovan.getByText(/can still reveal who you are/)).toBeVisible();
      await jovan.getByRole('button', { name: 'Send report' }).click();
      await expect(jovan.getByRole('heading', { name: 'Your report was received' })).toBeVisible({ timeout: 15_000 });
      await expect(jovan.getByText(/It is now case Reporter-[A-Z2-7]{4}, with the alternative recipient/)).toBeVisible();
      await expect(jovan.getByRole('link', { name: 'Open the case' })).toBeVisible();
    } finally {
      await employee.close();
    }
  });

  test('the listening screens fit a 390 px phone without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInWithEmailCode(page, WORKSPACE_URL, HR_EMAIL);
    for (const path of ['/listening', '/listening/heatmap', '/listening/surveys']) {
      await page.goto(`${WORKSPACE_URL}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls horizontally`).toBeLessThanOrEqual(0);
      // A heatmap row header, when a result is published, stays inside the viewport; the table itself may scroll.
      const header = page.getByRole('rowheader', { name: 'Whole organization' });
      if ((await header.count()) > 0) {
        const box = await header.first().boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      }
    }
  });
});
