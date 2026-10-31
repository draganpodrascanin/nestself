/**
 * Removes what earlier runs left in the journeys' database, then signs the
 * sample people in once per run and per project and stores their sessions:
 * the employee and the HR admin in the workspace (email code), the expert
 * and operations in the admin app (password and authenticator).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test as setup } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HR_APPROVER, removeJourneyAppointments, removeJourneyWebinars, setFollowUpPolicy } from './database';
import { ADMIN_URL, VIEWPORTS, WORKSPACE_URL, clientAddress, signInEmployee, signInExpert, signInOperations, signInWithEmailCode, stateFile } from './journey';
import type { Person } from './journey';

setup('journeys database starts clean', () => {
  removeJourneyAppointments();
  removeJourneyWebinars();
  // The approval journey switches the sample organisation to MANAGER_APPROVAL; every run starts from the default.
  setFollowUpPolicy('AUTOMATIC');
});

const SIGN_INS: Array<{ person: Person; label: string; signIn: (page: Page) => Promise<void> }> = [
  { person: 'employee', label: 'employee signs in to the workspace', signIn: signInEmployee },
  { person: 'expert', label: 'expert signs in to the admin app', signIn: signInExpert },
  { person: 'operations', label: 'operations signs in to the admin app', signIn: signInOperations },
  {
    person: 'hr',
    label: 'HR admin signs in to the workspace and switches to Manage',
    signIn: async (page) => {
      await signInWithEmailCode(page, HR_APPROVER);
      // HR starts in their personal context; the policy and approvals are organization screens.
      // The picker lists "Personal" and the organisation by name.
      await page.getByRole('button', { name: /^Working as Personal\. Switch context$/ }).click();
      await page.getByRole('menu', { name: 'Work as' }).getByRole('menuitem').filter({ hasNotText: /Personal/ }).first().click();
      await expect(page.getByRole('button', { name: /^Working as (?!Personal\.).+\. Switch context$/ })).toBeVisible({ timeout: 15_000 });
    },
  },
];

for (const { person, label, signIn } of SIGN_INS) {
  setup(label, async ({ browser }) => {
    // A session per project (desktop, mobile), so concurrent journeys never share one.
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        locale: 'en-GB',
        timezoneId: 'Europe/Belgrade',
        extraHTTPHeaders: { 'X-Forwarded-For': clientAddress(person, viewport, 'setup') },
      });
      const page = await context.newPage();
      await signIn(page);
      fs.mkdirSync(path.dirname(stateFile(person, viewport)), { recursive: true });
      await context.storageState({ path: stateFile(person, viewport) });
      await context.close();
    }
  });
}

/**
 * Warm both dev servers: the first load of a route makes Vite transform its
 * modules, which can delay `/auth/me` through the proxy long enough for the
 * app to treat the person as signed out. Every route the journeys open is
 * loaded once here, signed in, before any journey runs.
 */
setup('the apps are warm', async ({ browser }) => {
  const routes: Array<{ person: Person; urls: string[] }> = [
    { person: 'employee', urls: ['/appointments', '/appointments/appt_sample_upcoming', '/call/appt_sample_upcoming', '/webinars', '/webinars/webinar_sample_upcoming'] },
    { person: 'hr', urls: ['/follow-up-policy', '/approvals'] },
    { person: 'expert', urls: ['/consultations', '/consultations/appt_sample_upcoming'] },
    { person: 'operations', urls: ['/webinars', '/webinars/new', '/consultations', '/consultations/new'] },
  ];
  for (const { person, urls } of routes) {
    const context = await browser.newContext({
      storageState: stateFile(person, 'desktop'),
      locale: 'en-GB',
      timezoneId: 'Europe/Belgrade',
      extraHTTPHeaders: { 'X-Forwarded-For': clientAddress(person, 'desktop') },
    });
    const page = await context.newPage();
    const base = person === 'expert' || person === 'operations' ? ADMIN_URL : WORKSPACE_URL;
    for (const url of urls) {
      await page.goto(`${base}${url}`);
      await page.waitForLoadState('networkidle');
    }
    await context.close();
  }
});
