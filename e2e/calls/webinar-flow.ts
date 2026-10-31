/**
 * Shared steps of the webinar journeys (T-CW-2.6): operations creates and
 * publishes a webinar in the admin app (presenter: the sample expert;
 * moderator: the sample operations user; audience: the sample organisation,
 * which the operations user's assigned-clients scope covers, all chosen in
 * the form's pickers by name), hosts join
 * the live view and start it, the employee registers and joins. Media is the
 * fake meeting of `FakeVideoProvider` served by `fake-chime.ts`.
 */
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { EXPERT, OPERATIONS } from './database';
import { ADMIN_URL, WORKSPACE_URL } from './journey';
import { shot, viewportOf } from './manual';

const ZONE = 'Europe/Belgrade';

/** The recording notice (D-CW-34), in either punctuation the apps use. */
export const RECORDING_NOTICE = /^This webinar is recorded[.;] only the presenters are on the recording\.$/i;
const MINUTE = 60_000;

const hm = (date: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
const ymd = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(date);

export interface WebinarTitles {
  desktop: string;
  mobile: string;
}

export function titleFor(testInfo: TestInfo, titles: WebinarTitles): string {
  return titles[viewportOf(testInfo)];
}

/**
 * The admin form: English title, the sample organisation, 50 places, the
 * expert presenting and operations moderating, starting in ten minutes for
 * an hour (attendees may join from 15 minutes before, hosts from 30).
 * Returns the new webinar's id; the draft detail is on screen.
 */
export async function createWebinar(ops: Page, title: string, capture?: TestInfo, capacity = 50): Promise<string> {
  const start = new Date(Math.ceil((Date.now() + 10 * MINUTE) / MINUTE) * MINUTE);
  const end = new Date(start.getTime() + 60 * MINUTE);
  await ops.goto(`${ADMIN_URL}/webinars/new`);
  const form = ops.getByRole('form', { name: 'New webinar' });
  await expect(form).toBeVisible();
  await form.getByRole('group', { name: 'Title' }).getByRole('textbox', { name: 'English' }).fill(title);
  await form.getByRole('radio', { name: 'Selected organisations' }).check();
  // The pickers list the sample organisation (Example d.o.o.), the expert and the moderators by name.
  await form.getByRole('group', { name: 'Organisations' }).getByRole('checkbox').first().check();
  await form.getByRole('spinbutton', { name: 'Capacity' }).fill(String(capacity));
  await form.getByRole('checkbox', { name: EXPERT.displayName }).check();
  await form.getByRole('combobox', { name: 'Moderator' }).click();
  await ops.getByRole('option', { name: new RegExp(OPERATIONS.firstName) }).click();
  await form.getByRole('textbox', { name: 'Date', exact: true }).fill(ymd(start));
  await form.getByRole('textbox', { name: 'Start time', exact: true }).fill(hm(start));
  await form.getByRole('textbox', { name: 'End time', exact: true }).fill(hm(end));
  if (capture) await shot(ops, capture, 'operations-webinar-new-form');
  await ops.getByRole('button', { name: 'Save draft' }).click();
  // The draft's detail page (with or without a `created` marker in the query).
  await expect(ops).toHaveURL(/\/webinars\/(?!new(?:[/?]|$))[^/?]+(?:\?.*)?$/);
  await expect(ops.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(ops.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
  return new URL(ops.url()).pathname.split('/').pop()!;
}

export async function publishWebinar(ops: Page): Promise<void> {
  await ops.getByRole('button', { name: 'Publish', exact: true }).click();
  const confirm = ops.getByRole('alertdialog', { name: 'Publish this webinar?' });
  await confirm.getByRole('button', { name: 'Publish' }).click();
  await expect(ops.getByText('The webinar is published.')).toBeVisible();
}

async function joinWhenChecked(page: Page): Promise<void> {
  const join = page.getByRole('button', { name: 'Join now' });
  await expect(join).toBeEnabled({ timeout: 45_000 });
  await join.click();
}

/** A host opens the live view, passes the check and joins: the stage is on screen. */
export async function hostJoins(page: Page, webinarId: string): Promise<void> {
  await page.goto(`${ADMIN_URL}/webinars/${webinarId}/live`);
  await joinWhenChecked(page);
  await expect(page.getByTestId('webinar-stage')).toBeVisible();
}

/** The moderator starts the webinar: the stage goes live (the REC indicator follows the recording, DEF-5). */
export async function startWebinar(ops: Page): Promise<void> {
  await ops.getByRole('button', { name: 'Start webinar' }).click();
  // The live stage: Start is gone and the hosts' end control is there ("The webinar has started." is a passing announcement).
  await expect(ops.getByRole('button', { name: 'Start webinar' })).toHaveCount(0);
  await expect(ops.getByRole('button', { name: /^End webinar( for everyone)?$/ }).first()).toBeVisible();
}

/** The employee registers on the detail page (when not registered yet). */
export async function register(page: Page, webinarId: string): Promise<void> {
  await page.goto(`${WORKSPACE_URL}/webinars/${webinarId}`);
  const status = page.getByTestId('webinar-registration-status');
  await expect(status).toBeVisible();
  if ((await status.textContent())?.trim() !== 'You are registered.') {
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(status).toHaveText('You are registered.');
  }
}

/** From the detail page: Join webinar, the sound check, Join now. Before the start this lands in the lobby. */
export async function attendeeJoins(page: Page, webinarId: string): Promise<void> {
  await page.goto(`${WORKSPACE_URL}/webinars/${webinarId}`);
  await page.getByRole('button', { name: 'Join webinar' }).click();
  await expect(page).toHaveURL(new RegExp(`/webinars/${webinarId}/live$`));
  await joinWhenChecked(page);
}

/**
 * Socket.IO frames the page receives about the floor, parsed:
 * `[event, payload]`. The capabilities in `webinar.floor.given` are what the
 * API set on the provider for this attendee.
 */
export function recordFloorEvents(page: Page): Array<[string, Record<string, unknown>]> {
  const events: Array<[string, Record<string, unknown>]> = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.includes('webinar.floor')) return;
      const start = payload.indexOf('[');
      if (start < 0) return;
      try {
        const [name, body] = JSON.parse(payload.slice(start)) as [string, Record<string, unknown>];
        events.push([name, body]);
      } catch {
        // Not a JSON event frame.
      }
    });
  });
  return events;
}
