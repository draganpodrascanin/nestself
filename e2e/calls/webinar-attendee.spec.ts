/**
 * Webinar attendee journey (T-CW-2.6; WBN-01, WBN-02, WBN-06 to WBN-13,
 * WBN-20, D-CW-15, D-CW-34, D-CW-35): the sample employee finds a webinar, reads the recording notice,
 * registers, waits in the lobby (camera, hand and floor sentences, the
 * countdown), joins when the hosts start, watches the presenter, writes to
 * the hosts and sees a published message, asks a question and sees the
 * answer, votes, raises a hand, receives the floor with the dialog and its
 * recording sentence, has it taken back, leaves and rejoins, and is thanked
 * when the webinar ends. The hosts act in the admin app (operations
 * moderates, the expert presents); `webinar-moderator.spec.ts` asserts their
 * side.
 */
import { expect, test } from '@playwright/test';
import { fakeChime } from './fake-chime';
import { WORKSPACE_URL, expectApiMode, openAs } from './journey';
import type { PersonPage } from './journey';
import { shot } from './manual';
import { RECORDING_NOTICE, attendeeJoins, createWebinar, hostJoins, publishWebinar, startWebinar, titleFor } from './webinar-flow';

const TITLES = { desktop: 'Managing stress at work', mobile: 'Sleep and recovery basics' };

test.describe('webinar attendee (T-CW-2.6)', () => {
  test.describe.configure({ mode: 'serial' });

  let ops: PersonPage;
  let presenter: PersonPage;
  let attendee: PersonPage;
  let webinarId: string;
  let title: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    ops = await openAs(browser, testInfo, 'operations');
    presenter = await openAs(browser, testInfo, 'expert');
    attendee = await openAs(browser, testInfo, 'employee');
    title = titleFor(testInfo, TITLES);
    webinarId = await createWebinar(ops.page, title);
    await publishWebinar(ops.page);
  });

  test.afterAll(async () => {
    await ops?.context.close();
    await presenter?.context.close();
    await attendee?.context.close();
  });

  test('discovery, the recording notice and registration (WBN-01, WBN-02, D-CW-34)', async () => {
    const testInfo = test.info();
    const { page } = attendee;
    await page.goto(`${WORKSPACE_URL}/webinars`);
    await expect(page.getByRole('heading', { level: 1, name: 'Webinars' })).toBeVisible();
    // By id: a retried run may have published another webinar with the same title.
    const link = page.locator(`a[href$="/webinars/${webinarId}"]`);
    const card = page.getByRole('listitem').filter({ has: link });
    await expect(card).toBeVisible();
    await expect(card.getByText(RECORDING_NOTICE)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Register' })).toBeVisible();
    await expectApiMode(page);
    await shot(page, testInfo, 'employee-webinars-discovery');

    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(RECORDING_NOTICE)).toBeVisible();
    await expect(page.getByText('Presenters: Milica')).toBeVisible();
    await expect(page.getByTestId('webinar-registration-status')).toHaveText('You are not registered yet.');
    await shot(page, testInfo, 'employee-webinar-detail');

    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByTestId('webinar-registration-status')).toHaveText('You are registered.');
    const lobby = page.getByTestId('webinar-detail-lobby');
    await expect(lobby.getByText(/^Your camera stays off[.;] you can write to the hosts and raise your hand to ask for the floor\.$/i)).toBeVisible();
    await expect(page.getByTestId('webinar-detail-countdown')).toHaveText(/^Starts in \d{2}:\d{2}$/);
    await expect(lobby.getByRole('button', { name: 'Join webinar' })).toBeEnabled();
    // No attendee list or attendee's name anywhere on the page (D-CW-15); the header's
    // account menu names the signed-in viewer, so the check reads the main landmark.
    await expect(page.getByRole('main').getByText('Jovan')).toHaveCount(0);
    await shot(page, testInfo, 'employee-webinar-registered');
  });

  test('the lobby before the start: both sentences and the countdown (WBN-06)', async () => {
    const testInfo = test.info();
    const { page } = attendee;
    await attendeeJoins(page, webinarId);
    await expect(page.getByText('The hosts have not started yet. You join automatically when they start.')).toBeVisible();
    const lobby = page.getByTestId('webinar-lobby');
    await expect(lobby.getByText(RECORDING_NOTICE)).toBeVisible();
    await expect(lobby.getByText(/^Your camera stays off[.;] you can write to the hosts and raise your hand to ask for the floor\.$/i)).toBeVisible();
    await expect(lobby.getByText('If a host gives you the floor, your voice is part of the recording.')).toBeVisible();
    await expect(page.getByTestId('webinar-lobby-countdown')).toHaveText(/^Starts in \d{2}:\d{2}$/);
    await shot(page, testInfo, 'employee-webinar-lobby');
  });

  test('joins when the hosts start and sees the presenter (WBN-07, WBN-08)', async () => {
    const testInfo = test.info();
    const { page } = attendee;
    await hostJoins(presenter.page, webinarId);
    await hostJoins(ops.page, webinarId);
    await startWebinar(ops.page);
    await expect(page.getByTestId('webinar-attendee-controls')).toBeVisible({ timeout: 30_000 });
    // The presenter's camera arrives (fake media session: the other participant's tile).
    await fakeChime(page, 'remoteJoined');
    await expect(page.getByLabel(/presenter/i).locator('video').or(page.locator('[data-testid="webinar-stage"] video')).first()).toBeVisible();
    const controls = page.getByTestId('webinar-attendee-controls');
    await expect(controls.getByTestId('webinar-hand-raise')).toBeVisible();
    // Receive-only: no camera and no microphone until the floor (D-CW-35).
    await expect(page.getByRole('button', { name: /camera/i })).toHaveCount(0);
    await expect(page.getByTestId('webinar-floor-microphone')).toHaveCount(0);
    await shot(page, testInfo, 'employee-webinar-live');
  });

  test('writes to the hosts, sees a published message and an answered question (WBN-09, WBN-20)', async () => {
    const testInfo = test.info();
    const chat = attendee.page.getByTestId('webinar-chat-panel');
    const queue = ops.page.getByTestId('webinar-moderator-queue');
    const pending = (text: string) => queue.getByTestId('webinar-moderation-message').filter({ hasText: text });

    await chat.getByRole('radio', { name: 'Message', exact: true }).check();
    await chat.getByRole('textbox', { name: 'Write to the hosts' }).fill('Thank you, the breathing exercise helped.');
    await chat.getByRole('button', { name: 'Send to the hosts' }).click();
    await expect(attendee.page.getByTestId('webinar-chat-sent-notice')).toContainText('It appears in the chat only if a host publishes it.');
    // Not public until a host publishes it.
    await expect(chat.getByTestId('webinar-chat-message').filter({ hasText: 'breathing exercise' })).toHaveCount(0);
    await pending('breathing exercise').getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(chat.getByTestId('webinar-chat-message').filter({ hasText: 'breathing exercise' })).toBeVisible();

    await chat.getByRole('radio', { name: 'Question', exact: true }).check();
    await chat.getByRole('textbox', { name: 'Write to the hosts' }).fill('Can I do the exercise at my desk?');
    await chat.getByRole('button', { name: 'Send to the hosts' }).click();
    const question = pending('at my desk');
    await question.getByRole('button', { name: 'Answer', exact: true }).click();
    await question.getByRole('textbox', { name: 'Your answer' }).fill('Yes. Sit back, feet on the floor, and breathe out slowly.');
    await question.getByRole('button', { name: 'Publish answer' }).click();
    const answered = chat.getByTestId('webinar-chat-message').filter({ hasText: 'at my desk' });
    await expect(answered.getByText('Yes. Sit back, feet on the floor, and breathe out slowly.')).toBeVisible();
    await expect(answered.getByText('Answer from the hosts')).toBeVisible();
    await shot(attendee.page, testInfo, 'employee-webinar-chat-published', chat);
  });

  test('votes in a poll and sees the results when it closes (WBN-11)', async () => {
    const testInfo = test.info();
    const creator = ops.page.getByRole('region', { name: 'Prepare a poll' });
    await creator.getByRole('textbox', { name: 'Question' }).fill('Which break suits your day best?');
    await creator.getByRole('textbox', { name: 'Option 1' }).fill('A short walk');
    await creator.getByRole('textbox', { name: 'Option 2' }).fill('A breathing exercise');
    await creator.getByRole('button', { name: 'Add poll' }).click();
    await ops.page.getByTestId('webinar-poll-panel').getByRole('button', { name: 'Open poll' }).click();

    const poll = attendee.page.getByTestId('webinar-poll-panel');
    await expect(poll.getByText('Which break suits your day best?').first()).toBeVisible();
    // Voting without a choice is refused on screen.
    await poll.getByRole('button', { name: 'Vote' }).click();
    await expect(poll.getByText('Choose an option first.')).toBeVisible();
    await poll.getByRole('radio', { name: 'A breathing exercise' }).check();
    await shot(attendee.page, testInfo, 'employee-webinar-poll', poll);
    await poll.getByRole('button', { name: 'Vote' }).click();
    await expect(poll.getByTestId('webinar-poll-voted')).toBeVisible();
    await ops.page.getByTestId('webinar-poll-panel').getByRole('button', { name: 'Close poll' }).click();
    await expect(poll.getByTestId('webinar-poll-results')).toBeVisible();
  });

  test('raises a hand, gets the floor with the recording sentence, has it taken back (WBN-10, D-CW-35)', async () => {
    const testInfo = test.info();
    const { page } = attendee;
    await page.getByTestId('webinar-hand-raise').click();
    await expect(page.getByText('Your hand is raised. A host can give you the floor.').first()).toBeVisible();
    await shot(page, testInfo, 'employee-webinar-hand-raised');

    const queue = ops.page.getByTestId('webinar-moderator-queue');
    await queue.getByTestId('webinar-queue-hand').getByRole('button', { name: /Give the floor/ }).click();
    const dialog = page.getByRole('dialog', { name: 'You have the floor' });
    await expect(dialog).toContainText(/You can speak now[,.] unmute to talk\./i);
    await expect(dialog).toContainText('Your voice is part of the recording. Your camera stays off.');
    await shot(page, testInfo, 'employee-webinar-floor-dialog');
    await dialog.getByRole('button', { name: 'Unmute now' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('webinar-floor-microphone')).toBeVisible();
    await expect(page.getByRole('button', { name: /camera/i })).toHaveCount(0);

    await queue.getByTestId('webinar-queue-speaker').getByRole('button', { name: /Take the floor back/ }).click();
    const notice = page.getByTestId('webinar-floor-taken-notice');
    await expect(notice).toContainText('The host took the floor back. Your microphone is off again.');
    await notice.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByTestId('webinar-floor-microphone')).toHaveCount(0);
  });

  test('leaves, rejoins, and is thanked when the webinar ends (WBN-12, WBN-13, CW-R-36b)', async () => {
    const testInfo = test.info();
    const { page } = attendee;
    await page.getByTestId('webinar-attendee-controls').getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(new RegExp(`/webinars/${webinarId}$`));
    await attendeeJoins(page, webinarId);
    await expect(page.getByTestId('webinar-attendee-controls')).toBeVisible();

    await ops.page.getByRole('button', { name: /^End webinar( for everyone)?$/ }).first().click();
    await ops.page.getByRole('alertdialog', { name: /^End (this webinar|the webinar for everyone)\?$/ }).getByRole('button', { name: /^End webinar/ }).click();
    const thanks = page.getByTestId('webinar-thanks');
    await expect(thanks).toBeVisible({ timeout: 30_000 });
    await expect(thanks).toContainText('Thank you for joining');
    await expect(thanks).toContainText('The webinar has ended.');
    await shot(page, testInfo, 'employee-webinar-ended');
  });
});
