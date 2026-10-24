/**
 * Signs the sample employee (workspace, email code) and the sample expert
 * (admin, password and authenticator) in once per run, removes what earlier
 * runs left in the journeys' database, and stores both sessions for the
 * consultation journeys.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as setup } from '@playwright/test';
import { removeJourneyAppointments } from './database';
import { STATE, signInEmployee, signInExpert } from './journey';

setup('journeys database starts clean', () => {
  removeJourneyAppointments();
});

setup('employee signs in to the workspace', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Belgrade' });
  const page = await context.newPage();
  await signInEmployee(page);
  fs.mkdirSync(path.dirname(STATE.employee), { recursive: true });
  await context.storageState({ path: STATE.employee });
  await context.close();
});

setup('expert signs in to the admin app', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Belgrade' });
  const page = await context.newPage();
  await signInExpert(page);
  fs.mkdirSync(path.dirname(STATE.expert), { recursive: true });
  await context.storageState({ path: STATE.expert });
  await context.close();
});
