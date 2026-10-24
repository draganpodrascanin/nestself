/**
 * Consultation journeys (T-CW-1.7; CALL-02, CALL-03, CALL-07, CALL-08,
 * CALL-09, CALL-13, CALL-15, CALL-16, CALL-21, CALL-23, D-CW-37) against
 * the real API with `FakeVideoProvider`, Chromium's fake camera and
 * microphone (OPS-32) and the in-page media session of `fake-chime.ts`.
 *
 *   pnpm exec playwright test -c playwright.calls.config.ts
 *
 * Every journey creates its own appointments (`database.ts`) between the
 * sample employee (Jovan) and the sample expert (Milica), so the two
 * projects (desktop 1280 and mobile 390) run side by side. Screens for the
 * user manual are captured on the way (`manual.ts`).
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { MIN_IN_BETWEEN_FRAMES, MOTION, animatedProperties, animationsSeen, isAtRest, isInBetween, recordFrames } from '../motion/motion-helpers';
import type { Frame } from '../motion/motion-helpers';
import { appointmentStatus, callSession, closeJoinWindow, createAppointment } from './database';
import type { JourneyAppointment } from './database';
import { fakeChime } from './fake-chime';
import { ADMIN_URL, WORKSPACE_URL, expectApiMode, openAs, waitForJoinEnabled } from './journey';
import type { PersonPage } from './journey';
import { shot, viewportOf } from './manual';

const COPY = {
  prejoinTitle: 'Check your camera and microphone',
  joinNow: 'Join now',
  joinSession: 'Join session',
  stage: 'Video call',
  /** "Milica will join shortly", or "Your expert will join shortly" without a name. */
  waiting: /will join shortly$/,
  /** "Video: Milica" where the app knows the first name, otherwise "Video of the other participant". */
  remoteVideo: /^Video(: | of the other participant)/,
  endForEveryone: 'End for everyone',
  endConfirmTitle: 'End the consultation for both of you?',
  endConfirm: 'End consultation',
  sessionEndedNotice: 'The consultation has ended.',
  postCallEnded: 'The consultation has ended',
  outcomeTitle: 'Record the session outcome',
  joinWindowClosedError:
    'This session cannot be joined right now. Joining opens shortly before the start and closes 10 minutes after it; if you already joined, you can rejoin until shortly after the end.',
} as const;

/** Unique per project, so desktop and mobile never share an appointment. */
const tag = (testInfo: TestInfo, name: string) => `${name}_${viewportOf(testInfo)}`;

function annotateErrors(testInfo: TestInfo, ...people: PersonPage[]) {
  for (const person of people) {
    for (const error of person.errors) testInfo.annotations.push({ type: 'page error', description: error });
  }
}

/** Opens the employee's call route and waits for the pre-join check to pass. */
async function employeePrejoin(page: Page, appointment: JourneyAppointment): Promise<void> {
  await page.goto(`${WORKSPACE_URL}/call/${appointment.id}`);
  await expect(page.getByRole('heading', { name: COPY.prejoinTitle })).toBeVisible();
  await waitForJoinEnabled(page);
}

/** Employee: pre-join, then Join; the stage is on screen. */
async function employeeJoins(page: Page, appointment: JourneyAppointment, locationText?: string): Promise<void> {
  await employeePrejoin(page, appointment);
  if (locationText) await page.getByRole('textbox', { name: /Your current location/ }).fill(locationText);
  await page.getByRole('button', { name: COPY.joinNow }).click();
  await expect(page.getByRole('region', { name: COPY.stage })).toBeVisible();
  await expect(page.getByTestId('self-view')).toBeVisible();
}

/** Expert: the consultation page, Join session, the pre-join check, Join now; the stage is on screen. */
async function expertJoins(page: Page, appointment: JourneyAppointment): Promise<void> {
  await page.goto(`${ADMIN_URL}/consultations/${appointment.id}`);
  await page.getByRole('button', { name: COPY.joinSession }).click();
  await expect(page.getByRole('heading', { name: COPY.prejoinTitle })).toBeVisible();
  await waitForJoinEnabled(page);
  await page.getByRole('button', { name: COPY.joinNow }).click();
  await expect(page.getByRole('region', { name: COPY.stage })).toBeVisible();
}

/** Puts the element at the top of the viewport for a screenshot. */
async function scrollToTop(locator: Locator): Promise<void> {
  await locator.evaluate((element) => element.scrollIntoView({ block: 'start' }));
}

/** The self-view is a small corner tile, not the whole stage (DEF-2 regression guard). */
async function expectSelfViewInCorner(page: Page): Promise<void> {
  const stage = (await page.getByRole('region', { name: COPY.stage }).boundingBox())!;
  const selfView = (await page.getByTestId('self-view').boundingBox())!;
  expect(selfView.width).toBeLessThan(stage.width / 2);
  expect(selfView.height).toBeLessThan(stage.height / 2);
}

function expectPhase(frames: Frame[], phase: { duration: number; properties: string[] }) {
  const seen = animationsSeen(frames);
  expect(animatedProperties(seen)).toEqual([...phase.properties].sort());
  for (const animation of seen) {
    expect(animation.duration).toBe(phase.duration);
    expect(animation.easing).toBe(MOTION.easing);
  }
}

test.describe('join window on the appointment pages (CALL-02)', () => {
  test('list, before the window and inside it', async ({ browser }, testInfo) => {
    const employee = await openAs(browser, testInfo, 'employee');
    const { page } = employee;

    await page.goto(`${WORKSPACE_URL}/appointments`);
    await expect(page.getByRole('heading', { level: 1, name: 'Appointments' })).toBeVisible();
    const upcoming = page.getByRole('region', { name: 'Upcoming' });
    await expect(upcoming.getByText('Follow-up proposed')).toBeVisible();
    await expect(upcoming.getByText('Confirmed').first()).toBeVisible();
    await expectApiMode(page);
    await shot(page, testInfo, 'employee-appointments-list');

    // The seeded upcoming consultation (18 November): too early to join.
    await page.goto(`${WORKSPACE_URL}/appointments/appt_sample_upcoming`);
    const comeBack = page.getByRole('button', { name: /^Come back at \d{2}:\d{2}$/ });
    await expect(comeBack).toBeDisabled();
    await expect(page.getByText('You can join from 15 minutes before the start.')).toBeVisible();
    await shot(page, testInfo, 'employee-appointment-before-window');

    const appointment = createAppointment(tag(testInfo, 'window_open'), { startsInMinutes: 5 });
    await page.goto(`${WORKSPACE_URL}/appointments/${appointment.id}`);
    const join = page.getByRole('link', { name: COPY.joinSession });
    await expect(join).toBeVisible();
    await shot(page, testInfo, 'employee-appointment-join-open');
    await join.click();
    await expect(page).toHaveURL(new RegExp(`/call/${appointment.id}$`));
    await expect(page.getByRole('heading', { name: COPY.prejoinTitle })).toBeVisible();

    annotateErrors(testInfo, employee);
    await employee.context.close();
  });
});

test.describe('pre-join device check (CALL-03, D-CW-21)', () => {
  test('the real readiness check passes with fake devices, and camera off works', async ({ browser }, testInfo) => {
    const employee = await openAs(browser, testInfo, 'employee');
    const { page } = employee;
    const appointment = createAppointment(tag(testInfo, 'prejoin'), { startsInMinutes: 5 });

    await page.goto(`${WORKSPACE_URL}/call/${appointment.id}`);
    await expect(page.getByRole('heading', { name: COPY.prejoinTitle })).toBeVisible();
    // Join stays disabled until the check finished (CW-R-55a).
    await waitForJoinEnabled(page);
    const checks = page.getByRole('list').filter({ hasText: 'Connection' });
    await expect(checks.getByRole('listitem').filter({ hasText: 'Camera' })).toContainText('Working');
    await expect(checks.getByRole('listitem').filter({ hasText: 'Microphone' })).toContainText('Working');
    await expect(checks.getByRole('listitem').filter({ hasText: 'Connection' })).toContainText(/Good|Unstable|Fair/);
    await expect(page.getByLabel('Your camera preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play test sound' })).toBeVisible();
    // Device selection for camera, microphone and speaker.
    await expect(page.getByRole('combobox')).toHaveCount(3);
    await expectApiMode(page);
    await scrollToTop(page.getByRole('heading', { name: COPY.prejoinTitle }));
    await shot(page, testInfo, 'employee-prejoin-check');

    const cameraOff = page.getByRole('switch', { name: 'Join with camera off' });
    await cameraOff.click();
    await expect(cameraOff).toBeChecked();
    await expect(page.getByText('Your camera is off')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Blur my background' })).toBeVisible();
    await scrollToTop(page.getByText('Your camera is off'));
    await shot(page, testInfo, 'employee-prejoin-camera-off');
    await cameraOff.click();
    await expect(cameraOff).not.toBeChecked();

    annotateErrors(testInfo, employee);
    await employee.context.close();
  });
});

test.describe('consultation lifecycle (CALL-08, CALL-15, CALL-16, CALL-21, CALL-23, D-CW-37)', () => {
  test.describe.configure({ mode: 'serial' });

  let employee: PersonPage;
  let expert: PersonPage;
  let appointment: JourneyAppointment;

  test.beforeAll(async ({ browser }, testInfo) => {
    appointment = createAppointment(tag(testInfo, 'lifecycle'), { startsInMinutes: 3 });
    employee = await openAs(browser, testInfo, 'employee');
    expert = await openAs(browser, testInfo, 'expert');
  });

  test.afterAll(async () => {
    const testInfo = test.info();
    annotateErrors(testInfo, employee, expert);
    await employee?.context.close();
    await expert?.context.close();
  });

  test('both join and see each other; in-call controls work', async () => {
    const testInfo = test.info();
    // The employee is first in and waits for the expert.
    await employeeJoins(employee.page, appointment, 'Home office (sample)');
    await expect(employee.page.getByRole('heading', { name: COPY.waiting })).toBeVisible();
    await expect(employee.page.getByRole('timer', { name: 'Session time' })).toContainText('left');
    await expect(employee.page.getByTestId('connection-badge')).toHaveAttribute('data-quality', 'good');
    await expectSelfViewInCorner(employee.page);
    await expectApiMode(employee.page);
    await shot(employee.page, testInfo, 'employee-call-waiting');

    // The expert joins from the admin app; the room tells the employee (call.participant.joined).
    await expertJoins(expert.page, appointment);
    await expect(employee.page.getByRole('heading', { name: COPY.waiting })).toBeHidden();
    // Their video arrives (fake media session: the other participant's tile).
    await fakeChime(employee.page, 'remoteJoined');
    await fakeChime(expert.page, 'remoteJoined');
    await expect(employee.page.getByLabel(COPY.remoteVideo)).toBeVisible();
    await expect(expert.page.getByLabel(COPY.remoteVideo)).toBeVisible();
    await expectSelfViewInCorner(employee.page);
    // CALL-08 6: consultations are never recorded, so nothing says so.
    await expect(employee.page.getByText(/recording/i)).toHaveCount(0);
    await shot(employee.page, testInfo, 'employee-call-stage');

    // The psychological consultation's location reaches the expert only (CALL-34).
    await expect(expert.page.getByText('Home office (sample)')).toBeVisible();
    await expect(expert.page.getByRole('button', { name: COPY.endForEveryone })).toBeVisible();
    await expectApiMode(expert.page);
    await shot(expert.page, testInfo, 'expert-call-stage');

    // Mute is announced (CW-R-54) and reversible.
    await employee.page.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(employee.page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
    await expect(employee.page.getByTestId('control-bar-announcer')).not.toBeEmpty();
    await employee.page.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(employee.page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();

    // The employee can hide and show their own video (UX-10).
    await employee.page.getByRole('button', { name: 'Hide your video' }).click();
    await expect(employee.page.getByRole('button', { name: 'Show your video' })).toBeVisible();
    await employee.page.getByRole('button', { name: 'Show your video' }).click();
    await expect(employee.page.getByRole('button', { name: 'Hide your video' })).toBeVisible();

    if (viewportOf(testInfo) === 'mobile') {
      // UX-20: at 390 px the secondary controls collapse into "More".
      await employee.page.getByRole('button', { name: 'More' }).click();
      const menu = employee.page.getByRole('menu', { name: 'More' });
      await expect(menu.getByRole('menuitem', { name: 'I cannot hear you' })).toBeVisible();
      await shot(employee.page, testInfo, 'employee-control-bar-more');
      await employee.page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    } else {
      await expect(employee.page.getByRole('button', { name: 'I cannot hear you' })).toBeVisible();
    }

    // Crisis resources stay one tap away; the call keeps running (CALL-12).
    await employee.page.getByRole('button', { name: 'Crisis resources' }).click();
    const crisis = employee.page.getByRole('dialog', { name: 'Need urgent help?' });
    await expect(crisis).toBeVisible();
    await expect(crisis.getByRole('link').first()).toHaveAttribute('href', /^tel:/);
    await shot(employee.page, testInfo, 'employee-crisis-resources');
    await crisis.getByRole('button', { name: 'Close' }).click();
    await expect(crisis).toBeHidden();
    await expect(employee.page.getByRole('region', { name: COPY.stage })).toBeVisible();

    // A dropped connection shows the reconnecting state, which clears when it comes back (CALL-10, UX-12).
    await fakeChime(employee.page, 'reconnecting');
    const badge = employee.page.getByTestId('connection-badge');
    await expect(badge).toHaveAttribute('data-quality', 'poor');
    await expect(employee.page.getByText('Connection lost. Reconnecting…')).toBeVisible();
    await shot(employee.page, testInfo, 'employee-connection-reconnecting');
    await fakeChime(employee.page, 'reconnected');
    await expect(badge).toHaveAttribute('data-quality', 'good');
    await expect(employee.page.getByText('Connection lost. Reconnecting…')).toBeHidden();
  });

  test('"End for everyone" closes the session; the outcome dialog and the post-call screen follow', async () => {
    const testInfo = test.info();
    await expert.page.getByRole('button', { name: COPY.endForEveryone }).click();
    const confirm = expert.page.getByRole('alertdialog', { name: COPY.endConfirmTitle });
    await expect(confirm).toBeVisible();
    await shot(expert.page, testInfo, 'expert-end-for-everyone');

    // The outcome dialog animates in with the dialog preset (Motion rule; no Storybook story exists for it).
    // It opens once the end request returns, so the recording runs long enough for a slow API.
    // The employee hears it from the room (call.session.ended) and sees the notice for five seconds, meanwhile.
    const employeeSeesTheEnd = (async () => {
      await expect(employee.page.getByText(COPY.sessionEndedNotice)).toBeVisible({ timeout: 20_000 });
      await shot(employee.page, testInfo, 'employee-session-ended');
    })();
    const opening = await recordFrames(expert.page, '[role="dialog"]', () => confirm.getByRole('button', { name: COPY.endConfirm }).click(), 6_000);
    await employeeSeesTheEnd;
    expectPhase(opening, { duration: MOTION.standard, properties: ['opacity', 'transform'] });
    expect(opening.filter(isInBetween).length, 'the outcome dialog enters over several frames').toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
    expect(isAtRest(opening.at(-1)!)).toBe(true);
    const outcome = expert.page.getByRole('dialog', { name: COPY.outcomeTitle });
    await expect(outcome).toBeVisible();
    await expect(outcome.getByRole('radio')).toHaveCount(5);
    // No notes field (D-22, CW-R-21).
    await expect(outcome.getByRole('textbox')).toHaveCount(0);
    await shot(expert.page, testInfo, 'expert-outcome-dialog');

    // The server closed the session at the expert's request.
    await expect.poll(() => callSession(appointment.id)).toEqual({ status: 'ENDED', endReason: 'EXPERT' });

    // Then the employee's post-call screen.
    await expect(employee.page.getByRole('heading', { level: 1, name: COPY.postCallEnded })).toBeVisible({ timeout: 15_000 });
    await expect(employee.page.getByRole('heading', { name: 'How was your session?' })).toBeVisible();
    await expect(employee.page.getByText('Your feedback is private and your employer will not see it.')).toBeVisible();
    await shot(employee.page, testInfo, 'employee-post-call-feedback');
  });

  test('the employee reports a problem and sends feedback (CALL-15, CALL-16)', async () => {
    const testInfo = test.info();
    const { page } = employee;
    await page.getByRole('button', { name: 'Report a technical problem' }).click();
    const report = page.getByRole('dialog', { name: 'Report a technical problem' });
    await expect(report).toBeVisible();
    await expect(report.getByText('Call length')).toBeVisible();
    await expect(report.getByText('Operating system')).toBeVisible();
    const category = report.getByRole('radio', { name: 'Connection' });
    if (await category.count()) await category.check();
    await shot(page, testInfo, 'employee-report-problem');
    await report.getByRole('button', { name: 'Send report' }).click();
    await expect(report).toBeHidden();
    await expect(page.getByText(/^Report sent\./)).toBeVisible();

    // Sending without a rating names the problem on screen (error-visibility rule).
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(page.getByText('Choose a rating from 1 to 5, or skip.').first()).toBeVisible();
    await page.getByRole('radio', { name: '4 of 5' }).check();
    await page.getByRole('textbox', { name: /Comment/ }).fill('Clear sound and picture (journey test).');
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(page.getByText('Thank you. Your feedback was sent.')).toBeVisible();
  });

  test('the expert records the outcome and proposes a follow-up; the employee answers (CALL-23, D-CW-37)', async () => {
    const testInfo = test.info();
    const outcome = expert.page.getByRole('dialog', { name: COPY.outcomeTitle });
    // Saving without a choice is refused on screen.
    await outcome.getByRole('button', { name: 'Save outcome' }).click();
    await expect(outcome.getByText('Choose an outcome.').first()).toBeVisible();
    await outcome.getByRole('radio', { name: 'Completed' }).check();
    // The dialog leaves with the dialog preset's exit, visible until it is gone.
    const closing = await recordFrames(expert.page, '[role="dialog"]', () => outcome.getByRole('button', { name: 'Save outcome' }).click(), 2_000);
    expectPhase(closing, { duration: MOTION.fast, properties: ['opacity', 'transform'] });
    expect(closing.filter(isInBetween).length, 'the exit is seen, not an instant unmount').toBeGreaterThanOrEqual(2);
    expect(closing.at(-1)!.displayed).toBe(false);
    await expect(expert.page.getByText('Outcome recorded: Completed')).toBeVisible();
    await expect.poll(() => appointmentStatus(appointment.id)).toBe('COMPLETED');

    // The follow-up card: date, time and duration in the appointment's zone, no free text.
    const card = expert.page.getByRole('region', { name: 'Propose a follow-up' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Times are in the Europe/Belgrade time zone.')).toBeVisible();
    await shot(expert.page, testInfo, 'expert-follow-up-propose');
    const inTwoDays = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date(Date.now() + 2 * 86_400_000));
    await card.getByLabel('Date', { exact: true }).fill(inTwoDays);
    await card.getByLabel('Time', { exact: true }).fill('10:00');
    await card.getByRole('button', { name: 'Send proposal' }).click();
    await expect(expert.page.getByText(/^Proposed for .+ at 10:00/)).toBeVisible();

    // The proposal reaches the employee's post-call screen through the call room.
    const proposal = employee.page.getByRole('region', { name: 'Your expert proposed a follow-up' });
    await expect(proposal).toBeVisible();
    await shot(employee.page, testInfo, 'employee-follow-up-proposal');
    await proposal.getByRole('button', { name: 'Suggest other times' }).click();
    await expect(proposal.getByText('Suggest up to three times that suit you')).toBeVisible();
    await shot(employee.page, testInfo, 'employee-follow-up-suggest-times');
    await proposal.getByRole('button', { name: 'Cancel' }).click();
    await proposal.getByRole('button', { name: 'Confirm' }).click();
    await expect(proposal.getByText(/^(Your follow-up is booked for|Waiting for approval)/)).toBeVisible();
    await shot(employee.page, testInfo, 'employee-follow-up-confirmed');
  });
});

test.describe('connection quality (CALL-09)', () => {
  test('the badge follows 30-second quality intervals and degraded mode pauses outgoing video', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const employee = await openAs(browser, testInfo, 'employee');
    const { page } = employee;
    const appointment = createAppointment(tag(testInfo, 'quality'), { startsInMinutes: 5 });
    await employeeJoins(page, appointment);
    const badge = page.getByTestId('connection-badge');

    // Quality samples once a second, as the SDK's metricsDidReceive would send them.
    const sample = (observable: Record<string, number>) =>
      page.evaluate((metrics) => {
        const win = window as unknown as { __e2eSample: Record<string, number>; __e2eTimer?: number; __nestselfFakeChime: { current: { metrics: (m: Record<string, number>) => void } } };
        win.__e2eSample = metrics;
        win.__e2eTimer ??= window.setInterval(() => win.__nestselfFakeChime.current.metrics(win.__e2eSample), 1_000);
      }, observable);

    // Fair: round trip between 150 and 300 ms (UX-36).
    await sample({ currentRoundTripTimeMs: 220, audioUpstreamJitterMs: 10, audioPacketLossPercent: 0 });
    await expect(badge).toHaveAttribute('data-quality', 'degraded', { timeout: 45_000 });
    await expect(page.getByText('Your connection is unstable.', { exact: false })).toBeVisible();
    await shot(page, testInfo, 'employee-connection-degraded');

    // Poor for two intervals: outgoing video is paused, audio continues (UX-38).
    await sample({ currentRoundTripTimeMs: 480, audioUpstreamJitterMs: 90, audioPacketLossPercent: 6 });
    await expect(badge).toHaveAttribute('data-quality', 'poor', { timeout: 45_000 });
    await expect(page.getByText('Your video is paused due to connection quality. Audio continues.')).toBeVisible({ timeout: 45_000 });
    await shot(page, testInfo, 'employee-connection-video-paused');

    // Recovery: ten seconds of good samples resume the video and the banner leaves.
    await sample({ currentRoundTripTimeMs: 40, audioUpstreamJitterMs: 5, audioPacketLossPercent: 0 });
    await expect(page.getByText('Your video is paused due to connection quality. Audio continues.')).toBeHidden({ timeout: 30_000 });

    annotateErrors(testInfo, employee);
    await employee.context.close();
  });
});

test.describe('session timer (CALL-13)', () => {
  test('the five-minute cue appears near the end and can be dismissed', async ({ browser }, testInfo) => {
    const employee = await openAs(browser, testInfo, 'employee');
    const { page } = employee;
    // Started 6 minutes ago, 10 minutes long: a late first join is still allowed, 4 minutes remain.
    const appointment = createAppointment(tag(testInfo, 'five_minutes'), { startsInMinutes: -6, durationMinutes: 10 });
    await employeePrejoin(page, appointment);
    await expect(page.getByText(/^Your session started at \d{2}:\d{2}\. You can still join/)).toBeVisible();
    await page.getByRole('button', { name: COPY.joinNow }).click();
    await expect(page.getByRole('region', { name: COPY.stage })).toBeVisible();

    const cue = page.getByText('Five minutes left.');
    await expect(cue).toBeVisible();
    await shot(page, testInfo, 'employee-five-minute-cue');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(cue).toBeHidden();
    await expect(page.getByRole('timer', { name: 'Session time' })).toContainText('left');

    annotateErrors(testInfo, employee);
    await employee.context.close();
  });
});

test.describe('follow-up answers on the appointment page (CALL-37, CALL-42, D-CW-37)', () => {
  test('the employee suggests other times for one proposal and declines another', async ({ browser }, testInfo) => {
    const employee = await openAs(browser, testInfo, 'employee');
    const { page } = employee;
    const suggested = createAppointment(tag(testInfo, 'follow_up_suggest'), { startsInMinutes: 3 * 24 * 60, status: 'PROPOSED', followUpOf: 'appt_sample_completed' });
    const declined = createAppointment(tag(testInfo, 'follow_up_decline'), { startsInMinutes: 4 * 24 * 60, status: 'PROPOSED', followUpOf: 'appt_sample_completed' });

    await page.goto(`${WORKSPACE_URL}/appointments/${suggested.id}`);
    const card = page.getByRole('region', { name: 'Your expert proposed a follow-up' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Suggest other times' }).click();
    // An empty window is refused on screen before anything is sent.
    await card.getByRole('button', { name: 'Send suggestions' }).click();
    await expect(card.getByText('Choose a date and a time.').first()).toBeVisible();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date(Date.now() + 5 * 86_400_000));
    await card.getByLabel('Date', { exact: true }).fill(day);
    await card.getByLabel('From', { exact: true }).fill('09:00');
    await card.getByLabel('To', { exact: true }).fill('11:00');
    await card.getByRole('button', { name: 'Send suggestions' }).click();
    await expect(card.getByText('You suggested other times. The expert will choose one of them.')).toBeVisible();
    await shot(page, testInfo, 'employee-follow-up-times-suggested');

    await page.goto(`${WORKSPACE_URL}/appointments/${declined.id}`);
    const second = page.getByRole('region', { name: 'Your expert proposed a follow-up' });
    await second.getByRole('button', { name: 'Decline' }).click();
    await expect(second.getByText('You declined this follow-up.')).toBeVisible();
    await expect.poll(() => appointmentStatus(declined.id)).toBe('DECLINED');
    await shot(page, testInfo, 'employee-follow-up-declined');

    annotateErrors(testInfo, employee);
    await employee.context.close();
  });
});

test.describe('closed join window (CALL-07)', () => {
  test('the appointment page says the window closed and links to support', async ({ browser }, testInfo) => {
    const employee = await openAs(browser, testInfo, 'employee');
    const { page } = employee;
    const appointment = createAppointment(tag(testInfo, 'closed'), { startsInMinutes: -170 });
    await page.goto(`${WORKSPACE_URL}/appointments/${appointment.id}`);
    await expect(page.getByText('The join window for this session has closed.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/support');
    await expect(page.getByRole('link', { name: COPY.joinSession })).toHaveCount(0);
    await shot(page, testInfo, 'employee-window-closed');
    annotateErrors(testInfo, employee);
    await employee.context.close();
  });

  test('a join the API refuses (403 join_window_closed) shows the translated error', async ({ browser }, testInfo) => {
    const employee = await openAs(browser, testInfo, 'employee');
    const { page } = employee;
    const appointment = createAppointment(tag(testInfo, 'refused'), { startsInMinutes: 5 });
    await employeePrejoin(page, appointment);
    // The window closes on the server while the page still shows the check.
    closeJoinWindow(appointment.id);
    const refused = page.waitForResponse((response) => response.url().endsWith(`/appointments/${appointment.id}/join`));
    await page.getByRole('button', { name: COPY.joinNow }).click();
    const response = await refused;
    expect(response.status()).toBe(403);
    expect(JSON.stringify(await response.json())).toContain('join_window_closed');
    await expect(page.getByText(COPY.joinWindowClosedError)).toBeVisible();
    await expect(page.getByRole('region', { name: COPY.stage })).toHaveCount(0);
    await shot(page, testInfo, 'employee-join-refused');
    annotateErrors(testInfo, employee);
    await employee.context.close();
  });
});

test.describe('admin consultations (CALL-18, CALL-20)', () => {
  test('the expert sees the list and a consultation inside its join window', async ({ browser }, testInfo) => {
    const expert = await openAs(browser, testInfo, 'expert');
    const { page } = expert;
    const appointment = createAppointment(tag(testInfo, 'admin_detail'), { startsInMinutes: 8 });

    await page.goto(`${ADMIN_URL}/consultations`);
    await expect(page.getByRole('heading', { level: 1, name: 'Consultations' })).toBeVisible();
    await expect(page.getByText('Delivered').first()).toBeVisible();
    await expectApiMode(page);
    await shot(page, testInfo, 'expert-consultations-list');

    await page.goto(`${ADMIN_URL}/consultations/${appointment.id}`);
    await expect(page.getByRole('heading', { name: 'Participants' })).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.joinSession })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Send running late' })).toBeVisible();
    await shot(page, testInfo, 'expert-consultation-detail');
    annotateErrors(testInfo, expert);
    await expert.context.close();
  });
});
