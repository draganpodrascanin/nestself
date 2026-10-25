/**
 * Sign-in and context helpers for the consultation journeys.
 *
 * `auth.setup.ts` signs the two sample people in once per run and stores
 * their sessions in `e2e/.auth-state/` (git-ignored); every journey opens a
 * fresh browser context per person from that state, with the fake media
 * harness installed. The expert's authenticator secret is kept there too:
 * the fake identity provider remembers enrolment for the API process's
 * lifetime only, so a restarted API shows the enrolment screen again.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from '@playwright/test';
import type { Browser, BrowserContext, BrowserContextOptions, Page, TestInfo } from '@playwright/test';
import { computeTotp } from '../auth/totp';
import { EMPLOYEE, EXPERT, OPERATIONS } from './database';
import { installCallHarness } from './fake-chime';
import { ADMIN_URL, WORKSPACE_URL } from './servers.mjs';

export { ADMIN_URL, WORKSPACE_URL };

export const FIXED_OTP = '123456';
/** SAMPLE_DEV_PASSWORD in @nestself/sample-data (stub mode only). */
export const EXPERT_PASSWORD = 'Nestself-dev-1234!';

const STATE_DIR = path.resolve(import.meta.dirname, '../.auth-state');
export const STATE = {
  expertTotp: path.join(STATE_DIR, 'calls-expert-totp-secret.txt'),
  operationsTotp: path.join(STATE_DIR, 'calls-operations-totp-secret.txt'),
};

export type Viewport = 'desktop' | 'mobile';
export const VIEWPORTS: readonly Viewport[] = ['desktop', 'mobile'];

/**
 * One stored session per person and project: desktop and mobile run side
 * by side, and two browser contexts never share a session.
 */
export function stateFile(person: Person, viewport: Viewport): string {
  return path.join(STATE_DIR, `calls-${person}-${viewport}.json`);
}

/** The sample people the journeys sign in as: employee, expert (presenter), operations (webinar moderator), HR admin and approver. */
export type Person = 'employee' | 'expert' | 'operations' | 'hr';

/** Workspace sign-in with the email code (employees, HR). */
export async function signInWithEmailCode(page: Page, person: { email: string; firstName: string }): Promise<void> {
  await page.goto(`${WORKSPACE_URL}/sign-in`);
  await page.getByLabel('Email address').fill(person.email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Verification code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(person.firstName) })).toBeVisible({ timeout: 20_000 });
}

export const signInEmployee = (page: Page) => signInWithEmailCode(page, EMPLOYEE);

export const signInExpert = (page: Page) => signInStaff(page, EXPERT.email, STATE.expertTotp);

export const signInOperations = (page: Page) => signInStaff(page, OPERATIONS.email, STATE.operationsTotp);

/** Admin sign-in with password and authenticator; enrols on the first sign-in against an API process. */
export async function signInStaff(page: Page, email: string, totpFile: string): Promise<void> {
  await page.goto(`${ADMIN_URL}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({ timeout: 20_000 });
  await page.locator('#password-input').fill(EXPERT_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const enrol = page.getByRole('heading', { name: 'Set up two-factor authentication' });
  const challenge = page.getByRole('heading', { name: 'Two-factor authentication' });
  await expect(enrol.or(challenge)).toBeVisible({ timeout: 20_000 });
  if (await enrol.isVisible()) {
    const manualKey = page.getByText(/Or enter this key manually:/);
    await expect(manualKey).toBeVisible();
    const secret = (await manualKey.textContent())!.split(':').pop()!.trim();
    await page.getByLabel('Verification code').fill(computeTotp(secret));
    await page.getByRole('button', { name: 'Confirm setup' }).click();
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(totpFile, secret, 'utf-8');
  } else {
    const secret = fs.existsSync(totpFile) ? fs.readFileSync(totpFile, 'utf-8').trim() : '';
    expect(secret, 'authenticator screen without a stored secret: delete e2e/.auth-state and restart the journeys API').not.toBe('');
    await page.getByLabel('Authentication code').fill(computeTotp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 20_000 });
}

const PEOPLE: readonly Person[] = ['employee', 'expert', 'operations', 'hr'];

/**
 * A client address per person and project, sent as X-Forwarded-For: the API
 * rate-limits per address (60 requests a minute), and on one machine every
 * browser would otherwise share 127.0.0.1 and run into 429s that the apps
 * show as a signed-out screen. Distinct people on distinct machines.
 */
export function clientAddress(person: Person, viewport: Viewport, purpose: 'journey' | 'setup' = 'journey'): string {
  const network = purpose === 'setup' ? 18 : 17;
  return `10.${network}.${VIEWPORTS.indexOf(viewport) + 1}.${PEOPLE.indexOf(person) + 1}`;
}

/** The project's device (viewport, scale, touch) plus locale and media permissions, for a context per person. */
function contextOptions(testInfo: TestInfo, person: Person): BrowserContextOptions {
  const use = testInfo.project.use;
  const viewport: Viewport = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  return {
    extraHTTPHeaders: { 'X-Forwarded-For': clientAddress(person, viewport) },
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    locale: 'en-GB',
    timezoneId: 'Europe/Belgrade',
    permissions: ['camera', 'microphone'],
    reducedMotion: 'no-preference',
    storageState: stateFile(person, viewport),
  };
}

export interface PersonPage {
  context: BrowserContext;
  page: Page;
  /** Uncaught page errors, for a clean-console assertion at the end. */
  errors: string[];
}

export interface OpenOptions {
  /**
   * Serve the in-page media session for fake meetings (`fake-chime.ts`).
   * The nightly smoke test turns it off and joins a real Chime meeting.
   */
  fakeMedia?: boolean;
  /** Scripts to run before the app in every page of the context. */
  initScripts?: Array<() => void>;
}

/** A signed-in browser context for one person, English, with the fake media harness unless told otherwise. */
export async function openAs(browser: Browser, testInfo: TestInfo, person: Person, { fakeMedia = true, initScripts = [] }: OpenOptions = {}): Promise<PersonPage> {
  const context = await browser.newContext(contextOptions(testInfo, person));
  for (const script of initScripts) await context.addInitScript(script);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('nestself-locale', 'en');
    } catch {
      // Storage can be unavailable; the browser locale is English too.
    }
  });
  if (fakeMedia) await installCallHarness(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, errors };
}

/** CW-R-88: the journeys run in API mode, never sample mode. */
export async function expectApiMode(page: Page): Promise<void> {
  // The SampleDataBanner copy (common.sample.banner).
  await expect(page.getByText('Sample data. Nothing here is real, saved or sent.')).toHaveCount(0);
  // The header's API status (where the screen has a header) is not the sample-mode warning.
  await expect(page.getByText('API not connected (sample mode)')).toHaveCount(0);
}

/** Waits until the pre-join check finished and Join is enabled. */
export async function waitForJoinEnabled(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Join now' })).toBeEnabled({ timeout: 45_000 });
}
