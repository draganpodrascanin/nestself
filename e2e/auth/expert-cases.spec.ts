/**
 * Expert area journey (workspace `/cases`).
 *
 * Milica (sample expert, password + authenticator; enrols on her first
 * sign-in against the API process, see support.ts) opens her assigned cases:
 * `case_sample` is listed, its conversation `conv_sample` opens read-only and
 * shows the seeded fixture messages. The session is fresh, so the restricted
 * read does not ask for step-up: no "Verify your identity" dialog and no
 * `step_up_required` answer from the API.
 *
 * Nothing is created or changed. Labels come from
 * packages/i18n/locales/en/workspace.json (`cases`).
 */
import { test, expect } from '@playwright/test';
import { WORKSPACE_URL, signInWithPassword } from './support';

test.describe('Workspace expert area', () => {
  test('assigned cases list and conversation, no step-up on a fresh session', async ({ page }) => {
    const stepUpAnswers: string[] = [];
    page.on('response', async (res) => {
      if (res.status() !== 403 || !res.url().includes('/api/')) return;
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (body?.code === 'step_up_required') stepUpAnswers.push(res.url());
    });

    await signInWithPassword(page, WORKSPACE_URL, 'user_milica');
    await page.goto(`${WORKSPACE_URL}/cases`);
    await expect(page.getByRole('heading', { level: 1, name: 'Assigned cases' })).toBeVisible({ timeout: 15_000 });

    const table = page.getByRole('table', { name: 'Conversations of your assigned cases' });
    const row = table.getByRole('row').filter({ hasText: 'case_sample' });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.getByRole('link', { name: 'Open the conversation of case case_sample' }).click();

    await expect(page).toHaveURL(/\/cases\/conv_sample$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Case case_sample' })).toBeVisible({ timeout: 15_000 });
    const messages = page.getByRole('list', { name: 'Messages, oldest first' });
    await expect(messages.getByText('Sample message (fixture)')).toBeVisible({ timeout: 10_000 });
    await expect(messages.getByText('Sample reply (fixture)')).toBeVisible();
    await expect(page.getByText('Read only. Replies are not sent from this page.')).toBeVisible();

    await expect(page.getByRole('dialog', { name: 'Verify your identity' })).toHaveCount(0);
    expect(stepUpAnswers).toEqual([]);
  });
});
