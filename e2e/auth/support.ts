/**
 * Shared helpers for the auth journeys (`e2e/auth/*.spec.ts`) and the guide
 * screenshots (`e2e/screenshots/*.shot.ts`).
 *
 * - `signInWithEmailCode`: employees and HR (fixed stub OTP `123456`).
 * - `signInWithPassword`: staff and experts (password + authenticator). The
 *   fake identity provider keeps authenticator enrolment in memory for the
 *   API process lifetime, so the first password sign-in of a user against a
 *   fresh API shows the enrolment screen; the secret is then persisted in
 *   `e2e/.auth-state/<user>-totp-secret.txt` (git-ignored) and later sign-ins
 *   in the same run use it.
 * - `pageApi` / `signInAtIdpAs`: same-origin API calls from a signed-in page
 *   and the fake identity provider's choice of federated user (SSO journey
 *   and SSO screenshots).
 * - `stageGrant`: inserts a grant row into the disposable e2e database (never
 *   the developer database, see e2e-database.ts). Global setup drops the
 *   database at the start of the next run, so staged rows never outlive it.
 *   Staged ids end in `_e2e` or `_screenshots` so they read as staged.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { PERMISSION_TEMPLATES } from '../../packages/contracts/src/templates.ts';
import { e2eDatabaseUrl } from '../e2e-database.ts';
import { computeTotp } from './totp';
import { ADMIN_URL, WORKSPACE_URL } from '../ports';

export { ADMIN_URL, WORKSPACE_URL };
export const FIXED_OTP = '123456';
export const STAFF_PASSWORD = 'Nestself-dev-1234!';

const AUTH_STATE_DIR = path.resolve(import.meta.dirname, '..', '.auth-state');

/** `user_nikola` keeps the file name admin-sign-in.spec.ts has always used. */
function secretFile(userId: string): string {
  const short = userId.replace(/^user_/, '');
  return path.join(AUTH_STATE_DIR, `${short}-totp-secret.txt`);
}

function readSecret(userId: string): string | null {
  try {
    return fs.readFileSync(secretFile(userId), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function persistSecret(userId: string, secret: string): void {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });
  fs.writeFileSync(secretFile(userId), secret, 'utf-8');
}

/** Email-code sign-in; resolves once the app has left /sign-in. */
export async function signInWithEmailCode(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Verification code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });
}

/**
 * Password + authenticator sign-in for `user_<x>@example.com`. Enrols on the
 * first sign-in against this API process, otherwise answers the authenticator
 * screen with the persisted secret. Resolves once the app has left /sign-in.
 */
export async function signInWithPassword(page: Page, baseUrl: string, userId: string): Promise<void> {
  await page.goto(`${baseUrl}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(`${userId}@example.com`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({ timeout: 10_000 });
  // The show/hide toggle also carries "password" in its label.
  await page.locator('#password-input').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const enrolHeading = page.getByRole('heading', { name: 'Set up two-factor authentication' });
  const totpHeading = page.getByRole('heading', { name: 'Two-factor authentication' });
  await expect(enrolHeading.or(totpHeading)).toBeVisible({ timeout: 15_000 });

  if (await enrolHeading.isVisible()) {
    const manualKey = page.getByText(/Or enter this key manually:/);
    await expect(manualKey).toBeVisible({ timeout: 10_000 });
    const secret = (await manualKey.textContent())!.split(':').pop()!.trim();
    expect(secret.length).toBeGreaterThan(10);
    await page.getByLabel('Verification code').fill(computeTotp(secret));
    await page.getByRole('button', { name: 'Confirm setup' }).click();
    persistSecret(userId, secret);
  } else {
    const secret = readSecret(userId);
    expect(
      secret,
      `authenticator screen shown for ${userId} but no persisted secret; delete e2e/.auth-state and run again`,
    ).toBeTruthy();
    await page.getByLabel('Authentication code').fill(computeTotp(secret!));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });
}

/** The slice of `pg` used here; `pg` is a dependency of the API, not of the repository root. */
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}
const requireFromApi = createRequire(path.resolve(import.meta.dirname, '..', '..', 'apps', 'api', 'package.json'));

/** Runs statements against the disposable e2e database. */
export async function e2eSql(statements: Array<{ text: string; values: unknown[] }>): Promise<void> {
  const url = e2eDatabaseUrl();
  if (!url) throw new Error('TEST_DATABASE_URL or E2E_DATABASE_URL is required');
  const { Client } = requireFromApi('pg') as { Client: new (config: { connectionString: string }) => PgClient };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement.text, statement.values);
  } finally {
    await client.end();
  }
}

/** `REDIS_URL` from the environment, else from apps/api/.env (the stub API reads the same file). */
function redisUrl(): string | null {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  try {
    const env = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'apps', 'api', '.env'), 'utf-8');
    const line = env.split('\n').find((l) => l.trim().startsWith('REDIS_URL='));
    return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') || null : null;
  } catch {
    return null;
  }
}

interface RedisClient {
  connect(): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  del(keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
}

/**
 * Drops the cached principal, grants and assignments of `userId` from Redis.
 * Redis outlives the API process (and is shared with a developer's API), so
 * a principal cached by a previous run within its ~30 s TTL would otherwise
 * hide a freshly staged grant. Without REDIS_URL the API uses an in-memory
 * store, which a fresh API process starts empty.
 */
export async function forgetCachedPrincipal(userId: string): Promise<void> {
  const url = redisUrl();
  if (!url) return;
  const { createClient } = requireFromApi('redis') as { createClient: (opts: { url: string }) => RedisClient };
  const client = createClient({ url });
  await client.connect();
  try {
    const keys = [`principal:${userId}`, `assignments:${userId}`, ...(await client.keys(`grants:${userId}:*`))];
    await client.del(keys);
  } finally {
    await client.quit();
  }
}

/**
 * Stages a platform-scoped grant of `templateKey` for `userId` (idempotent)
 * and drops the user's cached principal, so the next sign-in sees the grant.
 * Call it before the user's first sign-in against this API process: the
 * process also keeps a short in-memory copy of the principal.
 */
export async function stagePlatformGrant(grantId: string, userId: string, templateKey: string): Promise<void> {
  const template = PERMISSION_TEMPLATES.find((tpl) => tpl.key === templateKey);
  if (!template) throw new Error(`${templateKey} template missing`);
  await e2eSql([
    {
      text: `insert into grants (id, subject_user_id, template_key, actions, scope_type, conditions, valid_from, granted_by_user_id)
             values ($1, $2, $3, $4, 'platform', '[]'::jsonb, now() - interval '1 minute', $2)
             on conflict (id) do nothing`,
      values: [grantId, userId, templateKey, [...template.actions]],
    },
  ]);
  await forgetCachedPrincipal(userId);
}

/**
 * `SAMPLE_PEOPLE` carries one real person, the developer account
 * `user_dragan` (added by the owner on 2026-10-24 to link the real dev pool,
 * flagged `sample: true`). Guide screenshots show fictional people only, so
 * the screenshot run removes that account from the disposable e2e database
 * before any capture (idempotent; the next global setup reseeds it). Member
 * lists are ordered by random membership ids, so filtering one screen at a
 * time would not reliably keep the row out of every capture.
 */
export const DEVELOPER_ACCOUNT_ID = 'user_dragan';

export async function removeDeveloperAccount(): Promise<void> {
  await e2eSql([
    { text: 'delete from grants where subject_user_id = $1', values: [DEVELOPER_ACCOUNT_ID] },
    { text: 'delete from memberships where user_id = $1', values: [DEVELOPER_ACCOUNT_ID] },
    { text: 'delete from external_identities where user_id = $1', values: [DEVELOPER_ACCOUNT_ID] },
    { text: 'delete from users where id = $1', values: [DEVELOPER_ACCOUNT_ID] },
  ]);
}

/** The fields the SSO journey and screenshots read from the API's JSON answers. */
export interface ApiBody {
  id?: string;
  startUrl?: string;
  status?: string;
  lastTestedAt?: string | null;
  [key: string]: unknown;
}

/** Same-origin JSON call from the page (cookies + CSRF header like the app's client). */
export async function pageApi(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: ApiBody }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('nestself_csrf='))?.split('=')[1] ?? '';
      const res = await fetch(path, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
    },
    { method, path, body },
  );
}

/**
 * Creates an OIDC connection with its client secret, which registers the
 * provider at once (a staged registration). An API process reused from an
 * earlier run still has that provider in the fake IdP and answers the staged
 * create with 409; the row is then created without the secret, and the test
 * step updates the provider the fake kept.
 */
export async function createOidcConnection(
  page: Page,
  body: { orgId: string; slug: string; oidcIssuer: string; oidcClientId: string },
  clientSecret: string,
): Promise<{ status: number; body: ApiBody }> {
  const connection = { ...body, protocol: 'OIDC' };
  const staged = await pageApi(page, 'POST', '/api/ops/sso-connections', { ...connection, oidcClientSecret: clientSecret });
  if (staged.status !== 409) return staged;
  return pageApi(page, 'POST', '/api/ops/sso-connections', connection);
}

/**
 * The employer IdP "signs in" `email`: the 302 from `/api/auth/sso/start` to
 * the fake authorize hop gets `as=<email>` appended. Playwright does not
 * route redirected requests, so the start request is fetched here without
 * following the redirect and answered with the amended Location.
 *
 * `emailVerified: false` also appends `email_verified=false`: an address the
 * fake identity provider first meets that way is created unverified, as an
 * OIDC provider that does not confirm it would assert it (an address it
 * already knows keeps the state it had).
 */
export async function signInAtIdpAs(
  context: BrowserContext,
  email: string,
  options: { emailVerified?: boolean } = {},
): Promise<void> {
  await context.route((url) => url.pathname === '/api/auth/sso/start', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers()['location'];
    if (response.status() !== 302 || !location) {
      await route.fulfill({ response });
      return;
    }
    const target = new URL(location);
    if (target.pathname === '/api/auth/sso/_fake/authorize') {
      target.searchParams.set('as', email);
      if (options.emailVerified === false) target.searchParams.set('email_verified', 'false');
    }
    // Keep the API's headers: the browser-binding cookie must reach the browser.
    await route.fulfill({ response, headers: { ...response.headers(), location: target.toString() } });
  });
}
