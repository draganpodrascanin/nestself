/**
 * Webinar moderator journey (T-CW-2.6; WBN-09 to WBN-11, WBN-16, WBN-17,
 * WBN-21, WBN-23 to WBN-25, WBN-27 to WBN-31, D-CW-15, D-CW-34, D-CW-35): operations creates and publishes a webinar, the expert presents,
 * operations moderates: starts it (the recording starts with it), publishes
 * an attendee's message, answers a question, dismisses a message, prepares,
 * opens and closes a poll, gives the floor to the attendee who raised a hand
 * and takes it back, stops the recording early with confirmation and ends
 * the webinar for everyone. The sample employee is the attendee.
 *
 * The floor's capabilities: the API sets them on the provider's attendee
 * (`updateParticipantCapabilities`) and tells the attendee in
 * `webinar.floor.given`; the journey reads that event's capabilities and the
 * attendee's join response, and checks that the screen offers a microphone
 * and never a camera. The fake meeting itself lives inside the API process.
 */
import { expect, test } from '@playwright/test';
import { webinarState } from './database';
import { ADMIN_URL, expectApiMode, openAs } from './journey';
import type { PersonPage } from './journey';
import { shot } from './manual';
import { RECORDING_NOTICE, attendeeJoins, createWebinar, hostJoins, publishWebinar, recordFloorEvents, register, startWebinar, titleFor } from './webinar-flow';

const TITLES = { desktop: 'Building calm team habits', mobile: 'Focus without overload' };

test.describe('webinar moderator (T-CW-2.6)', () => {
  test.describe.configure({ mode: 'serial' });

  let ops: PersonPage;
  let presenter: PersonPage;
  let attendee: PersonPage;
  let webinarId: string;
  let floorEvents: Array<[string, Record<string, unknown>]>;
  let joinCapabilities: Record<string, string> | null = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    ops = await openAs(browser, testInfo, 'operations');
    presenter = await openAs(browser, testInfo, 'expert');
    attendee = await openAs(browser, testInfo, 'employee');
    floorEvents = recordFloorEvents(attendee.page);
    attendee.page.on('response', async (response) => {
      if (response.request().method() === 'POST' && /\/api\/webinars\/[^/]+\/join$/.test(response.url()) && response.ok()) {
        const body = (await response.json()) as { attendee?: { Capabilities?: Record<string, string> } };
        joinCapabilities = body.attendee?.Capabilities ?? null;
      }
    });
  });

  test.afterAll(async () => {
    await ops?.context.close();
    await presenter?.context.close();
    await attendee?.context.close();
  });

  test('operations creates, edits and publishes a webinar (WBN-30, WBN-31)', async () => {
    const testInfo = test.info();
    await ops.page.goto(`${ADMIN_URL}/webinars`);
    await expect(ops.page.getByRole('heading', { level: 1, name: 'Webinars' })).toBeVisible();
    await expect(ops.page.getByRole('link', { name: 'New webinar' }).or(ops.page.getByRole('button', { name: 'New webinar' }))).toBeVisible();
    await expectApiMode(ops.page);
    await shot(ops.page, testInfo, 'operations-webinars-list');

    webinarId = await createWebinar(ops.page, titleFor(testInfo, TITLES), testInfo);
    // Every webinar is recorded; the form and the detail say so, there is no switch (D-CW-34).
    await expect(ops.page.getByText(RECORDING_NOTICE)).toBeVisible();
    await expect(ops.page.getByRole('switch')).toHaveCount(0);
    await shot(ops.page, testInfo, 'operations-webinar-detail-publish');

    // A draft can be edited (WBN-30): fewer places and an English description.
    await ops.page.getByRole('link', { name: 'Edit', exact: true }).or(ops.page.getByRole('button', { name: 'Edit', exact: true })).first().click();
    await expect(ops.page).toHaveURL(new RegExp(`/webinars/${webinarId}/edit$`));
    const form = ops.page.getByRole('form', { name: 'Edit webinar' });
    await expect(form).toBeVisible();
    await form.getByRole('spinbutton', { name: 'Capacity' }).fill('40');
    await form.getByRole('group', { name: 'Description' }).getByRole('textbox', { name: 'English' }).fill('Small daily habits that keep a team calm under pressure.');
    await shot(ops.page, testInfo, 'operations-webinar-edit');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(ops.page).toHaveURL(new RegExp(`/webinars/${webinarId}$`));
    await expect(ops.page.getByText('Up to 40 attendees')).toBeVisible();
    await publishWebinar(ops.page);
    await expect.poll(() => webinarState(webinarId).status).toBe('PUBLISHED');
  });

  test('hosts join and the moderator starts the webinar (WBN-16, WBN-17)', async () => {
    const testInfo = test.info();
    await register(attendee.page, webinarId);
    await attendeeJoins(attendee.page, webinarId);
    await expect(attendee.page.getByText('The hosts have not started yet. You join automatically when they start.')).toBeVisible();

    await hostJoins(presenter.page, webinarId);
    await expect(presenter.page.getByRole('button', { name: 'Start webinar' })).toBeVisible();
    await expect(presenter.page.getByTestId('webinar-self-view').or(presenter.page.getByTestId('self-view'))).toBeVisible();
    await shot(presenter.page, testInfo, 'expert-webinar-presenter-view');

    await hostJoins(ops.page, webinarId);
    await startWebinar(ops.page);
    await expect.poll(() => webinarState(webinarId).status).toBe('LIVE');
    // The attendee was waiting in the lobby and joins on the room's `live`.
    await expect(attendee.page.getByTestId('webinar-attendee-controls')).toBeVisible({ timeout: 30_000 });
    await expect(ops.page.getByTestId('webinar-queue-attendance')).toContainText('1');
    // Attendees join receive-only: video and content `Receive`, no audio until the floor (D-CW-35).
    expect(joinCapabilities?.['Video']).toBe('Receive');
    expect(joinCapabilities?.['Content']).toBe('Receive');
    expect(joinCapabilities?.['Audio']).not.toBe('SendReceive');
  });

  test('the moderator publishes, answers and dismisses messages (WBN-09, WBN-23, WBN-24)', async () => {
    const testInfo = test.info();
    const chat = attendee.page.getByTestId('webinar-chat-panel');
    const send = async (kind: 'Message' | 'Question', text: string) => {
      await chat.getByRole('radio', { name: kind, exact: true }).check();
      await chat.getByRole('textbox', { name: 'Write to the hosts' }).fill(text);
      await chat.getByRole('button', { name: 'Send to the hosts' }).click();
      await expect(attendee.page.getByTestId('webinar-chat-sent-notice')).toBeVisible();
    };
    const queue = ops.page.getByTestId('webinar-moderator-queue');
    const pending = (text: string) => queue.getByTestId('webinar-moderation-message').filter({ hasText: text });

    await send('Message', 'How do you keep a short break from turning into a long one?');
    await expect(pending('How do you keep a short break')).toBeVisible();
    // A raised hand at the same time, for the console as the manual shows it.
    await attendee.page.getByTestId('webinar-hand-raise').click();
    await expect(queue.getByTestId('webinar-queue-hand')).toHaveCount(1);
    await shot(ops.page, testInfo, 'operations-webinar-moderator-console', queue);

    await pending('How do you keep a short break').getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(pending('How do you keep a short break')).toHaveCount(0);
    await expect(chat.getByTestId('webinar-chat-message').filter({ hasText: 'How do you keep a short break' })).toBeVisible();

    await send('Question', 'Is ten minutes enough for a break?');
    const question = pending('Is ten minutes enough');
    await question.getByRole('button', { name: 'Answer', exact: true }).click();
    await question.getByRole('textbox', { name: 'Your answer' }).fill('Often, yes: step away from the screen and move a little.');
    await question.getByRole('button', { name: 'Publish answer' }).click();
    await expect(chat.getByText('Often, yes: step away from the screen and move a little.')).toBeVisible();

    await send('Message', 'Off-topic note for the hosts only.');
    await pending('Off-topic note').getByRole('button', { name: 'Dismiss' }).click();
    await expect(pending('Off-topic note')).toHaveCount(0);
    await expect(chat.getByText('Off-topic note for the hosts only.')).toHaveCount(0);
  });

  test('the moderator prepares, opens and closes a poll (WBN-11, WBN-27)', async () => {
    const creator = ops.page.getByRole('region', { name: 'Prepare a poll' });
    await creator.getByRole('textbox', { name: 'Question' }).fill('How often do you take a break?');
    await creator.getByRole('textbox', { name: 'Option 1' }).fill('Every hour');
    await creator.getByRole('textbox', { name: 'Option 2' }).fill('Twice a day');
    await creator.getByRole('button', { name: 'Add poll' }).click();
    await expect(creator.getByText('Poll added. Open it when you are ready.')).toBeVisible();

    const hostPoll = ops.page.getByTestId('webinar-poll-panel');
    await hostPoll.getByRole('button', { name: 'Open poll' }).click();
    const attendeePoll = attendee.page.getByTestId('webinar-poll-panel');
    await attendeePoll.getByRole('radio', { name: 'Every hour' }).check();
    await attendeePoll.getByRole('button', { name: 'Vote' }).click();
    await expect(attendeePoll.getByTestId('webinar-poll-voted')).toBeVisible();

    await hostPoll.getByRole('button', { name: 'Close poll' }).click();
    await expect(attendeePoll.getByTestId('webinar-poll-results')).toBeVisible();
    await expect(attendeePoll.getByText('Votes: 1')).toBeVisible();
  });

  test('the floor: audio only, video stays receive-only, mute, ask to unmute, taken back (WBN-10, WBN-25, WBN-26, D-CW-35)', async () => {
    const queue = ops.page.getByTestId('webinar-moderator-queue');
    await queue.getByTestId('webinar-queue-hand').getByRole('button', { name: /Give the floor/ }).click();
    const dialog = attendee.page.getByRole('dialog', { name: 'You have the floor' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/You can speak now[,.] unmute to talk\./i);
    await expect(dialog).toContainText('Your voice is part of the recording. Your camera stays off.');
    await expect.poll(() => floorEvents.find(([name]) => name === 'webinar.floor.given')?.[1]['capabilities']).toEqual({
      audio: 'send_receive',
      video: 'receive',
      content: 'receive',
    });
    await dialog.getByRole('button', { name: 'Unmute now' }).click();
    await expect(attendee.page.getByTestId('webinar-floor-microphone')).toBeVisible();
    // Still no camera control for the attendee.
    await expect(attendee.page.getByRole('button', { name: /camera/i })).toHaveCount(0);
    const speaker = queue.getByTestId('webinar-queue-speaker');
    await expect(speaker).toHaveCount(1);

    // WBN-26: a host mutes the speaker, then asks to unmute (the attendee decides; see the next test).
    await speaker.getByRole('button', { name: /^Mute\b/ }).click();
    await expect(speaker.getByText('Muted', { exact: true })).toBeVisible();
    await speaker.getByRole('button', { name: /^Ask .*to unmute$/ }).click();
    await expect(speaker.getByText('Asked to unmute')).toBeVisible();
    await expect.poll(() => floorEvents.map(([name]) => name)).toEqual(expect.arrayContaining(['webinar.floor.muted', 'webinar.floor.unmute_requested']));
    await shot(ops.page, test.info(), 'operations-webinar-speaker-row', queue);

    await queue.getByTestId('webinar-queue-speaker').getByRole('button', { name: /Take the floor back/ }).click();
    await expect(attendee.page.getByTestId('webinar-floor-taken-notice')).toBeVisible();
    await expect.poll(() => floorEvents.some(([name]) => name === 'webinar.floor.taken')).toBe(true);
    await expect(attendee.page.getByTestId('webinar-floor-microphone')).toHaveCount(0);
  });

  test('the recording starts with the webinar and the moderator stops it early (WBN-28, CW-R-107)', async () => {
    const testInfo = test.info();
    await expect(ops.page.getByTestId('webinar-rec-indicator')).toBeVisible();
    await expect(attendee.page.getByTestId('webinar-rec-indicator')).toBeVisible();
    await expect.poll(() => webinarState(webinarId).recording).toBe('RECORDING');
    const queue = ops.page.getByTestId('webinar-moderator-queue');
    await queue.getByRole('button', { name: 'Stop recording' }).click();
    const confirm = ops.page.getByRole('alertdialog', { name: 'Stop the recording now?' });
    await expect(confirm).toContainText('The rest of the webinar is not recorded, and the recording cannot be started again.');
    await shot(ops.page, testInfo, 'operations-webinar-stop-recording');
    await confirm.getByRole('button', { name: 'Stop recording' }).click();
    await expect(queue.getByText('Not recording')).toBeVisible();
    await expect(attendee.page.getByTestId('webinar-rec-indicator')).toHaveCount(0);
    await expect.poll(() => webinarState(webinarId).recording).not.toBe('RECORDING');
  });

  test('asked to unmute, the attendee consents before the microphone opens (WBN-26)', async () => {
    const queue = ops.page.getByTestId('webinar-moderator-queue');
    await attendee.page.getByTestId('webinar-hand-raise').click();
    await queue.getByTestId('webinar-queue-hand').getByRole('button', { name: /Give the floor/ }).click();
    await attendee.page.getByRole('dialog', { name: 'You have the floor' }).getByRole('button', { name: 'Unmute now' }).click();
    const speaker = queue.getByTestId('webinar-queue-speaker');
    await speaker.getByRole('button', { name: /^Mute\b/ }).click();
    await speaker.getByRole('button', { name: /^Ask .*to unmute$/ }).click();
    const consent = attendee.page.getByRole('dialog', { name: 'The host asks you to unmute. Unmute?' });
    await expect(consent).toContainText('Your voice is part of the recording. Your camera stays off.');
    await shot(attendee.page, test.info(), 'employee-webinar-unmute-request');
    await consent.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(consent).toBeHidden();
    await speaker.getByRole('button', { name: /Take the floor back/ }).click();
  });

  test('the moderator ends the webinar for everyone; the attendance follows (WBN-21, WBN-29, WBN-33)', async () => {
    await ops.page.getByRole('button', { name: /^End webinar( for everyone)?$/ }).first().click();
    // The stage's confirmation ("End this webinar?") or the console's ("End the webinar for everyone?").
    const confirm = ops.page.getByRole('alertdialog', { name: /^End (this webinar|the webinar for everyone)\?$/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^End webinar/ }).click();
    await expect(attendee.page.getByTestId('webinar-thanks')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => webinarState(webinarId).status).toBe('ENDED');
    await expect(presenter.page.getByText('The webinar has ended.').first()).toBeVisible();

    // WBN-33: the attendance per registration, without names, on the ended webinar's detail.
    await ops.page.goto(`${ADMIN_URL}/webinars/${webinarId}`);
    const attendance = ops.page.getByRole('table', { name: /Attendance per registration, without names/ });
    await expect(attendance).toBeVisible();
    await expect(attendance.getByRole('row', { name: /Registration 1/ })).toBeVisible();
    await expect(attendance).not.toContainText('Jovan');
    await shot(ops.page, test.info(), 'operations-webinar-attendance', attendance);
  });
});
