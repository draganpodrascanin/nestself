/**
 * Operations consultation screens for the user manual (NS-CALLS-01, CALL-28).
 * The operations persona (Nikola) holds the `client_operations` template:
 *   - `/consultations`: the operations list with Expert and Organisation
 *     columns and filters.
 *   - `/consultations/new`: a filled "New consultation" form.
 *   - `/consultations/:id`: the created consultation's detail page with the
 *     "Cancel appointment" confirmation dialog open.
 *
 * Screen 93 (`support-calls-lookup`, `/support/calls`) is skipped: Nikola's
 * `support_operator` grant has scope `assigned_cases` and the e2e seed creates
 * no `SUPPORT_CASE` assignment, so `diagnostic.read` is absent from his
 * effective actions and the route gate redirects to the overview.
 *
 * Every journey creates its own appointments (`database.ts`) so the two
 * projects (desktop 1280 and mobile 390) run side by side.
 */
import { expect, test } from '@playwright/test';
import { createAppointment } from './database';
import { ADMIN_URL, expectApiMode, openAs } from './journey';
import type { PersonPage } from './journey';
import { shot, viewportOf } from './manual';

/** Unique per project, so desktop and mobile never share an appointment. */
const tag = (name: string, viewport: 'desktop' | 'mobile') => `ops_${name}_${viewport}`;

test.describe('operations consultations (CALL-28)', () => {
  let ops: PersonPage;

  test.beforeEach(async ({ browser }, testInfo) => {
    ops = await openAs(browser, testInfo, 'operations');
  });

  test.afterEach(async () => {
    await ops?.context.close();
  });

  test('list, new form and cancel dialog', async () => {
    // Three Select interactions (each waits for an API load) plus two navigations
    // and a cancel dialog: the default 120 s is tight on a cold Vite dev server.
    test.setTimeout(180_000);
    const testInfo = test.info();
    const viewport = viewportOf(testInfo);
    const { page } = ops;

    // --- Screen 90: operations consultations list ---
    await page.goto(`${ADMIN_URL}/consultations`);
    await expect(page.getByRole('heading', { level: 1, name: 'Consultations' })).toBeVisible();
    // The operations view has the Expert and Organisation columns (visible on desktop only).
    if (viewport === 'desktop') {
      await expect(page.getByRole('columnheader', { name: 'Expert' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Organisation' })).toBeVisible();
    }
    await expectApiMode(page);
    await shot(page, testInfo, 'operations-consultations-list');

    // --- Screen 91: new consultation form filled in ---
    await page.goto(`${ADMIN_URL}/consultations/new`);
    await expect(page.getByRole('heading', { level: 1, name: 'New consultation' })).toBeVisible();

    // Organisation, Employee and Expert are Base-UI Selects with keepMounted portals.
    // Closed popups stay in the DOM at opacity 0, so getByRole('option').first() can
    // pick up an option from a CLOSED Select's portal and wait forever for it to become
    // visible. Instead: click the combobox, wait for it to expand (aria-expanded="true"),
    // press Enter to select the [active] first option, and wait for it to close.
    async function pickFirst(label: string) {
      const cb = page.getByRole('combobox', { name: label });
      await cb.click({ timeout: 30_000 });
      await expect(cb).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
      await page.keyboard.press('Enter');
      await expect(cb).not.toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
    }

    await pickFirst('Organisation');
    // The member list loads after the org is picked; the Employee combobox appears once loaded.
    await pickFirst('Employee');
    await pickFirst('Expert');

    // Category: "Psychological support" is the default.
    // Date and times: use getByRole('textbox') because getByLabel('Date', { exact: true })
    // does not match — the <label> text includes the required asterisk ("Date*").
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(tomorrow);
    await page.getByRole('textbox', { name: 'Date', exact: true }).fill(dateStr);
    await page.getByRole('textbox', { name: 'Start time', exact: true }).fill('10:00');
    await page.getByRole('textbox', { name: 'End time', exact: true }).fill('10:45');

    // Assert the form is visibly filled before the shot.
    await expect(page.getByRole('textbox', { name: 'Date', exact: true })).toHaveValue(dateStr);
    await expect(page.getByRole('textbox', { name: 'Start time', exact: true })).toHaveValue('10:00');
    await expect(page.getByRole('textbox', { name: 'End time', exact: true })).toHaveValue('10:45');
    await expectApiMode(page);
    await shot(page, testInfo, 'operations-consultation-new');

    // --- Screen 92: cancel dialog on the detail page ---
    // Create a fresh appointment that can be canceled (in the future, CONFIRMED).
    const appointment = createAppointment(tag('cancel', viewport), { startsInMinutes: 60 });
    await page.goto(`${ADMIN_URL}/consultations/${appointment.id}`);
    // The operations view shows the read-only detail (not the expert's view).
    await expect(page.getByText('Operations view: read-only.')).toBeVisible();
    // Open the cancel dialog.
    await page.getByRole('button', { name: 'Cancel appointment' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel this appointment?' });
    await expect(dialog).toBeVisible();
    await shot(page, testInfo, 'operations-consultation-cancel');
    // Do not confirm: we only need the screenshot with the dialog open.
    await dialog.getByRole('button', { name: 'Keep appointment' }).click();
    await expect(dialog).toBeHidden();
  });
});
