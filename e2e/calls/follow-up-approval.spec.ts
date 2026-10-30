/**
 * Follow-up approval journey (T-CW-1.10 step 11; CALL-36, CALL-38, CALL-40,
 * CALL-41, D-CW-37): HR switches the sample organisation to manager
 * approval, the expert proposes a follow-up after a completed consultation,
 * the employee confirms it and waits, and the approver (the sample HR admin,
 * who holds the approval authority for the employee's unit) approves one and
 * declines another with a reason the employee then sees.
 *
 * The completed consultations are written straight into the journeys'
 * database (`createCompletedConsultation`), so no call has to run first.
 * Each project uses its own dates, so desktop and mobile never pick each
 * other's approval item.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { appointmentStatus, approvalOf, createCompletedConsultation, followUpOfConsultation, followUpPolicy } from './database';
import { ADMIN_URL, WORKSPACE_URL, expectApiMode, openAs } from './journey';
import type { PersonPage } from './journey';
import { shot, viewportOf } from './manual';

const ZONE = 'Europe/Belgrade';
const DECLINE_REASON = 'Please book it after the team planning week.';

/** A day a few days ahead, different per project and per case: date input value and the day as the approver list shows it. */
function proposalDay(testInfo: TestInfo, offset: number) {
  const days = (viewportOf(testInfo) === 'desktop' ? 3 : 5) + offset;
  const day = new Date(Date.now() + days * 86_400_000);
  return {
    input: new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(day),
    dayMonth: new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'long' }).format(day),
  };
}

/** The expert proposes a follow-up on the consultation page; returns the new follow-up's id. */
async function propose(expert: Page, consultationId: string, dateInput: string, time: string): Promise<string> {
  await expert.goto(`${ADMIN_URL}/consultations/${consultationId}`);
  const card = expert.getByRole('region', { name: 'Propose a follow-up' });
  await expect(card).toBeVisible();
  await card.getByLabel('Date', { exact: true }).fill(dateInput);
  await card.getByLabel('Time', { exact: true }).fill(time);
  await card.getByRole('button', { name: 'Send proposal' }).click();
  await expect(expert.getByText(new RegExp(`^Proposed for .+ at ${time}`))).toBeVisible();
  const followUp = followUpOfConsultation(consultationId);
  expect(followUp?.status).toBe('PROPOSED');
  return followUp!.id;
}

/** The employee confirms the proposal on the follow-up's page and is told it waits for approval. */
async function confirmAndWait(employee: Page, followUpId: string): Promise<void> {
  await employee.goto(`${WORKSPACE_URL}/appointments/${followUpId}`);
  const card = employee.getByRole('region', { name: 'Your expert proposed a follow-up' });
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card.getByText('Waiting for approval')).toBeVisible();
  await expect(card.getByText('Your organisation approves follow-ups before they are booked.', { exact: false })).toBeVisible();
  await expect.poll(() => appointmentStatus(followUpId)).toBe('AWAITING_APPROVAL');
  await expect.poll(() => approvalOf(followUpId)?.status).toBe('PENDING');
}

/** The approver's pending item for that day and time. */
function approvalItem(page: Page, dayMonth: string, time: string): Locator {
  return page
    .getByRole('listitem')
    .filter({ hasText: dayMonth })
    .filter({ hasText: time })
    .filter({ has: page.getByRole('button', { name: 'Approve' }) });
}

test.describe('follow-up approval (T-CW-1.10)', () => {
  test.describe.configure({ mode: 'serial' });

  let hr: PersonPage;
  let expert: PersonPage;
  let employee: PersonPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    hr = await openAs(browser, testInfo, 'hr');
    expert = await openAs(browser, testInfo, 'expert');
    employee = await openAs(browser, testInfo, 'employee');
  });

  test.afterAll(async () => {
    await hr?.context.close();
    await expert?.context.close();
    await employee?.context.close();
  });

  test('HR switches the organisation to manager approval (CALL-38)', async () => {
    const testInfo = test.info();
    const { page } = hr;
    await page.goto(`${WORKSPACE_URL}/follow-up-policy`);
    await expect(page.getByRole('heading', { level: 1, name: 'Follow-up approval' })).toBeVisible();
    const managerApproval = page.getByRole('radio', { name: /An approver decides first/ });
    // The other project may have saved it already; then there is nothing to save.
    if (!(await managerApproval.isChecked())) {
      await managerApproval.check();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('The follow-up approval policy is saved.')).toBeVisible();
    }
    await expect(managerApproval).toBeChecked();
    await expect.poll(() => followUpPolicy()).toBe('MANAGER_APPROVAL');
    await expectApiMode(page);
    await shot(page, testInfo, 'hr-follow-up-policy');
  });

  test('the employee confirms, the approver approves, the follow-up is booked (CALL-36, CALL-40)', async () => {
    const testInfo = test.info();
    const consultation = createCompletedConsultation(`approve_${viewportOf(testInfo)}`);
    const day = proposalDay(testInfo, 0);
    const followUpId = await propose(expert.page, consultation.id, day.input, '10:00');

    await confirmAndWait(employee.page, followUpId);
    await shot(employee.page, testInfo, 'employee-follow-up-awaiting-approval');

    await hr.page.goto(`${WORKSPACE_URL}/approvals`);
    await expect(hr.page.getByRole('heading', { level: 1, name: 'Follow-up approvals' })).toBeVisible();
    const item = approvalItem(hr.page, day.dayMonth, '10:00');
    await expect(item).toBeVisible();
    // The approver sees who, a fixed label, when and how long; never the service or the expert (D-CW-37).
    await expect(item).toContainText('Follow-up session with a NestSelf expert');
    await expect(item).not.toContainText(/psycholog/i);
    await expect(item).not.toContainText('Milica');
    await shot(hr.page, testInfo, 'hr-approvals-list');
    await item.getByRole('button', { name: 'Approve' }).click();
    await expect(hr.page.getByText(/^Follow-up approved\./)).toBeVisible();
    await expect.poll(() => approvalOf(followUpId)?.status).toBe('APPROVED');
    await expect.poll(() => appointmentStatus(followUpId)).toBe('CONFIRMED');

    await employee.page.goto(`${WORKSPACE_URL}/appointments/${followUpId}`);
    await expect(employee.page.getByText('Confirmed').first()).toBeVisible();
    await shot(employee.page, testInfo, 'employee-follow-up-approved');
  });

  test('the approver declines with a reason the employee sees (CALL-41)', async () => {
    const testInfo = test.info();
    const consultation = createCompletedConsultation(`decline_${viewportOf(testInfo)}`);
    const day = proposalDay(testInfo, 0);
    const followUpId = await propose(expert.page, consultation.id, day.input, '11:30');
    await confirmAndWait(employee.page, followUpId);

    await hr.page.goto(`${WORKSPACE_URL}/approvals`);
    const item = approvalItem(hr.page, day.dayMonth, '11:30');
    await item.getByRole('button', { name: 'Decline' }).click();
    const dialog = hr.page.getByRole('alertdialog', { name: 'Decline this follow-up?' }).or(hr.page.getByRole('dialog', { name: 'Decline this follow-up?' }));
    await expect(dialog).toBeVisible();
    // A reason is required and shown on screen when missing (error-visibility rule).
    await dialog.getByRole('button', { name: 'Decline' }).click();
    await expect(dialog.getByText('Write a short reason.').first()).toBeVisible();
    await dialog.getByRole('textbox', { name: /Reason/ }).fill(DECLINE_REASON);
    await shot(hr.page, testInfo, 'hr-approval-decline-dialog');
    await dialog.getByRole('button', { name: 'Decline' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => approvalOf(followUpId)).toEqual({ status: 'REJECTED', reason: DECLINE_REASON });
    await expect.poll(() => appointmentStatus(followUpId)).toBe('DECLINED');

    await employee.page.goto(`${WORKSPACE_URL}/appointments/${followUpId}`);
    await expect(employee.page.getByText(`Your manager declined this follow-up: ${DECLINE_REASON}`)).toBeVisible();
    await shot(employee.page, testInfo, 'employee-follow-up-declined-by-manager');
  });
});
