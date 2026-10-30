/**
 * Webinar operations beyond the live journeys (T-CW-2.6 close review):
 * operations cancels a published webinar and the registered employee sees
 * it (WBN-32); a webinar with 300 places uses media replication, and an
 * attendee in a replica meeting gets the floor by promotion to the primary,
 * audio only (WBN-35, WBN-36, D-CW-14, D-CW-35); and the moderators' notice
 * when the recording fails (WBN-28).
 */
import { expect, test } from '@playwright/test';
import { webinarState } from './database';
import { WORKSPACE_URL, openAs } from './journey';
import type { PersonPage } from './journey';
import { shot, viewportOf } from './manual';
import { attendeeJoins, createWebinar, hostJoins, publishWebinar, recordFloorEvents, register, startWebinar } from './webinar-flow';

test.describe('webinar operations (T-CW-2.6)', () => {
  let ops: PersonPage;
  let presenter: PersonPage;
  let attendee: PersonPage;

  test.beforeEach(async ({ browser }, testInfo) => {
    ops = await openAs(browser, testInfo, 'operations');
    presenter = await openAs(browser, testInfo, 'expert');
    attendee = await openAs(browser, testInfo, 'employee');
  });

  test.afterEach(async () => {
    await ops?.context.close();
    await presenter?.context.close();
    await attendee?.context.close();
  });

  test('operations cancels a published webinar; the registered employee sees it (WBN-32)', async () => {
    const testInfo = test.info();
    const webinarId = await createWebinar(ops.page, viewportOf(testInfo) === 'desktop' ? 'Planning quiet hours' : 'Evening wind-down routines');
    await publishWebinar(ops.page);
    await register(attendee.page, webinarId);

    await ops.page.getByRole('button', { name: 'Cancel webinar' }).click();
    const confirm = ops.page.getByRole('alertdialog', { name: 'Cancel this webinar?' });
    await expect(confirm).toContainText('Registered employees receive a cancellation email. This cannot be undone.');
    await shot(ops.page, testInfo, 'operations-webinar-cancel');
    await confirm.getByRole('button', { name: 'Cancel webinar' }).click();
    await expect(ops.page.getByText('The webinar is canceled.')).toBeVisible();
    await expect.poll(() => webinarState(webinarId).status).toBe('CANCELED');

    await attendee.page.goto(`${WORKSPACE_URL}/webinars/${webinarId}`);
    await expect(attendee.page.getByText('This webinar was canceled.')).toBeVisible();
    await expect(attendee.page.getByRole('button', { name: 'Join webinar' })).toHaveCount(0);
    await shot(attendee.page, testInfo, 'employee-webinar-canceled');
  });

  test('300 places: a replica attendee gets the floor by promotion, audio only (WBN-35, WBN-36, D-CW-14)', async () => {
    const testInfo = test.info();
    const floorEvents = recordFloorEvents(attendee.page);
    let joinedMeeting = '';
    attendee.page.on('response', async (response) => {
      if (response.request().method() === 'POST' && /\/api\/webinars\/[^/]+\/join$/.test(response.url()) && response.ok()) {
        const body = (await response.json()) as { meeting?: { MeetingId?: string; Meeting?: { MeetingId?: string } } };
        joinedMeeting = body.meeting?.MeetingId ?? body.meeting?.Meeting?.MeetingId ?? '';
      }
    });
    const webinarId = await createWebinar(ops.page, viewportOf(testInfo) === 'desktop' ? 'Resilience in large teams' : 'Leading through change', undefined, 300);
    await publishWebinar(ops.page);
    await register(attendee.page, webinarId);
    await attendeeJoins(attendee.page, webinarId);
    await hostJoins(presenter.page, webinarId);
    await hostJoins(ops.page, webinarId);
    await startWebinar(ops.page);
    await expect(attendee.page.getByTestId('webinar-attendee-controls')).toBeVisible({ timeout: 30_000 });
    // Above one meeting's 250 the attendee is placed in a replica (`fake-meeting-{session}-r{n}`).
    await expect.poll(() => joinedMeeting).toMatch(/^fake-meeting-.+-r\d+$/);

    await attendee.page.getByTestId('webinar-hand-raise').click();
    await ops.page.getByTestId('webinar-moderator-queue').getByTestId('webinar-queue-hand').getByRole('button', { name: /Give the floor/ }).click();
    const dialog = attendee.page.getByRole('dialog', { name: 'You have the floor' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => floorEvents.find(([name]) => name === 'webinar.floor.given')?.[1]['capabilities']).toEqual({
      audio: 'send_receive',
      video: 'receive',
      content: 'receive',
    });
    await shot(attendee.page, testInfo, 'employee-webinar-replica-floor');
    await dialog.getByRole('button', { name: 'Unmute now' }).click();
    // The attendee's client joined the primary meeting for audio (promoteToPrimaryMeeting).
    await expect
      .poll(() => attendee.page.evaluate(() => ((window as unknown as { __nestselfFakeChime?: { promotions?: unknown[] } }).__nestselfFakeChime?.promotions ?? []).length))
      .toBeGreaterThan(0);
    await expect(attendee.page.getByTestId('webinar-floor-microphone')).toBeVisible();
    await expect(attendee.page.getByRole('button', { name: /camera/i })).toHaveCount(0);

    await ops.page.getByTestId('webinar-moderator-queue').getByTestId('webinar-queue-speaker').getByRole('button', { name: /Take the floor back/ }).click();
    await expect(attendee.page.getByTestId('webinar-floor-taken-notice')).toBeVisible();
    await expect(attendee.page.getByTestId('webinar-floor-microphone')).toHaveCount(0);
  });

  test('moderators are told when the recording fails (WBN-28)', async () => {
    test.fixme(
      true,
      'No hook makes FakeVideoProvider.startRecording fail: the fake lives inside the API process and the API exposes no test route or env switch for it, so the failure notice cannot be driven from the journeys.',
    );
  });
});
