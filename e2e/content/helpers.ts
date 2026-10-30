/**
 * Content e2e helpers: API-driven CMS workflow and sign-in utilities.
 *
 * The admin editor UI is not yet wired to API mode (T-C1.12 stubbed).
 * These helpers drive the CMS workflow through direct API calls so the
 * reader-side (workspace) steps can run for real now. Once the admin UI
 * fix lands, the UI path replaces `setupArticleViaApi`.
 */
import type { Page, APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { computeTotp } from '../auth/totp';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Ports (read from env; defaults match playwright.content.config.ts)
// ---------------------------------------------------------------------------

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return Number(raw);
}

export const API_PORT = port('E2E_API_PORT', 4130);
export const WORKSPACE_PORT = port('E2E_WORKSPACE_PORT', 5303);
export const ADMIN_PORT = port('E2E_ADMIN_PORT', 5304);

export const API_URL = `http://localhost:${API_PORT}`;
export const WORKSPACE_URL = `http://localhost:${WORKSPACE_PORT}`;
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const FIXED_OTP = '123456';
export const STAFF_PASSWORD = 'Nestself-dev-1234!';

export const USERS = {
  author: { id: 'user_katarina', email: 'user_katarina@example.com', displayName: 'Katarina' },
  reviewer: { id: 'user_darko', email: 'user_darko@example.com', displayName: 'Darko' },
  publisher: { id: 'user_teodora', email: 'user_teodora@example.com', displayName: 'Teodora' },
  employeeA: { id: 'user_jovan', email: 'user_jovan@example.com', displayName: 'Jovan' },
  employeeB: { id: 'user_emilija', email: 'user_emilija@example.com', displayName: 'Emilija' },
  multiOrg: { id: 'user_mirjam', email: 'user_mirjam@example.com', displayName: 'Mirjam' },
} as const;

// ---------------------------------------------------------------------------
// TOTP secret persistence (same pattern as e2e/auth)
// ---------------------------------------------------------------------------

const AUTH_STATE_DIR = path.resolve(import.meta.dirname, '..', '.auth-state');

function totpSecretFile(userId: string): string {
  return path.join(AUTH_STATE_DIR, `${userId}-totp-secret.txt`);
}

function readPersistedSecret(userId: string): string | null {
  try {
    return fs.readFileSync(totpSecretFile(userId), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function persistSecret(userId: string, secret: string): void {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });
  fs.writeFileSync(totpSecretFile(userId), secret, 'utf-8');
}

// ---------------------------------------------------------------------------
// Sign-in: employee (email OTP)
// ---------------------------------------------------------------------------

/**
 * Sign in an employee user through the workspace UI.
 * Returns after the authenticated home heading is visible.
 */
export async function signInEmployee(
  page: Page,
  user: { email: string; displayName: string },
): Promise<void> {
  await page.goto(`${WORKSPACE_URL}/sign-in`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor({ timeout: 10_000 });
  await page.getByLabel('Verification code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('heading', { name: new RegExp(user.displayName, 'i') }).waitFor({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Sign-in: staff (password + TOTP) via admin UI
// ---------------------------------------------------------------------------

/**
 * Sign in a staff user through the admin UI (password + TOTP).
 * Handles both first-time TOTP enrolment and subsequent sign-ins.
 */
export async function signInStaff(
  page: Page,
  user: { id: string; email: string },
): Promise<void> {
  await page.goto(`${ADMIN_URL}/sign-in`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Password step
  await page.getByRole('heading', { name: 'Enter your password' }).waitFor({ timeout: 10_000 });
  await page.locator('#password-input').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // TOTP step
  const enrolHeading = page.getByRole('heading', { name: 'Set up two-factor authentication' });
  const totpHeading = page.getByRole('heading', { name: 'Two-factor authentication' });
  await enrolHeading.or(totpHeading).waitFor({ timeout: 15_000 });

  if (await enrolHeading.isVisible()) {
    const manualKey = page.getByText(/Or enter this key manually:/);
    await manualKey.waitFor({ timeout: 10_000 });
    const secret = (await manualKey.textContent())!.split(':').pop()!.trim();
    await page.getByLabel('Verification code').fill(computeTotp(secret));
    await page.getByRole('button', { name: 'Confirm setup' }).click();
    persistSecret(user.id, secret);
  } else {
    const secret = readPersistedSecret(user.id);
    if (!secret) {
      throw new Error(
        `TOTP secret not found for ${user.id}; delete e2e/.auth-state and restart the API`,
      );
    }
    await page.getByLabel('Authentication code').fill(computeTotp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
  }

  // Wait for admin home
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Sign-in: staff via API (for page.request use)
// ---------------------------------------------------------------------------

/**
 * Extract the raw secret from an `otpauth://totp/...?secret=<raw>&...` URI.
 */
function extractSecretFromUri(secretUri: string): string {
  const url = new URL(secretUri);
  const secret = url.searchParams.get('secret');
  if (!secret) throw new Error(`No secret in otpauth URI: ${secretUri}`);
  return secret;
}

/**
 * Sign in a staff user programmatically through the API. Returns the
 * CSRF double-submit token that must be sent as `X-CSRF-Token` on every
 * subsequent state-changing request.
 *
 * Staff users in stub mode always go through password + TOTP. On a fresh
 * API process (database reset), the first sign-in triggers TOTP enrolment;
 * subsequent sign-ins use the persisted secret.
 */
export async function signInStaffApi(
  request: APIRequestContext,
  user: { id: string; email: string },
): Promise<string> {
  // Discover
  await request.post(`${API_URL}/api/auth/discover`, {
    data: { email: user.email },
  });

  // Password
  const pwResp = await request.post(`${API_URL}/api/auth/password`, {
    data: { email: user.email, password: STAFF_PASSWORD },
    headers: { origin: `http://localhost:${ADMIN_PORT}` },
  });
  if (!pwResp.ok()) {
    throw new Error(
      `Password sign-in failed (${user.email}): HTTP ${pwResp.status()} ${await pwResp.text()}`,
    );
  }
  const pwBody = await pwResp.json();

  if (pwBody.step) {
    let challengeToken: string = pwBody.challengeToken;

    if (pwBody.step === 'totp_enrol') {
      // First sign-in: enrol TOTP -- /auth/totp/enrol returns
      // { secretUri: "otpauth://...", challengeToken: "<new>" }.
      const enrolResp = await request.post(`${API_URL}/api/auth/totp/enrol`, {
        data: { challengeToken },
      });
      if (!enrolResp.ok()) {
        throw new Error(
          `TOTP enrol failed (${user.email}): HTTP ${enrolResp.status()} ${await enrolResp.text()}`,
        );
      }
      const enrolBody = await enrolResp.json() as { secretUri: string; challengeToken: string };
      const secret = extractSecretFromUri(enrolBody.secretUri);
      // The enrol response issues a new challengeToken
      challengeToken = enrolBody.challengeToken;

      const code = computeTotp(secret);
      const challengeResp = await request.post(`${API_URL}/api/auth/challenge`, {
        data: { challengeToken, response: code },
        headers: { origin: `http://localhost:${ADMIN_PORT}` },
      });
      if (!challengeResp.ok()) {
        throw new Error(
          `TOTP challenge (enrol) failed (${user.email}): HTTP ${challengeResp.status()} ${await challengeResp.text()}`,
        );
      }
      const challengeBody = await challengeResp.json();
      if (challengeBody.step) {
        throw new Error(`Unexpected step after TOTP enrol: ${JSON.stringify(challengeBody)}`);
      }
      persistSecret(user.id, secret);
    } else {
      // Already enrolled: use persisted secret
      const secret = readPersistedSecret(user.id);
      if (!secret) {
        throw new Error(
          `TOTP secret not found for ${user.id}; delete e2e/.auth-state and restart the API`,
        );
      }
      const code = computeTotp(secret);
      const challengeResp = await request.post(`${API_URL}/api/auth/challenge`, {
        data: { challengeToken, response: code },
        headers: { origin: `http://localhost:${ADMIN_PORT}` },
      });
      if (!challengeResp.ok()) {
        throw new Error(
          `TOTP challenge failed (${user.email}): HTTP ${challengeResp.status()} ${await challengeResp.text()}`,
        );
      }
      const challengeBody = await challengeResp.json();
      if (challengeBody.step) {
        throw new Error(`Unexpected step after TOTP: ${JSON.stringify(challengeBody)}`);
      }
    }
  }
  // Cookies are now set on the request context; extract the CSRF token.
  return extractCsrfToken(request);
}

/**
 * Sign in an employee user programmatically through the API.
 */
export async function signInEmployeeApi(
  request: APIRequestContext,
  user: { email: string },
): Promise<void> {
  // Discover
  await request.post(`${API_URL}/api/auth/discover`, {
    data: { email: user.email },
  });

  // Start OTP
  const otpStartResp = await request.post(`${API_URL}/api/auth/email-otp/start`, {
    data: { email: user.email },
  });
  const otpStartBody = await otpStartResp.json();
  const challengeToken = otpStartBody.challengeToken;

  // Verify OTP
  await request.post(`${API_URL}/api/auth/email-otp/verify`, {
    data: { challengeToken, code: FIXED_OTP },
    headers: { origin: `http://localhost:${WORKSPACE_PORT}` },
  });
}

// ---------------------------------------------------------------------------
// CSRF token helpers
// ---------------------------------------------------------------------------

/**
 * In insecure dev mode (`SESSION_COOKIE_INSECURE_DEV=true`) the API strips
 * the `__Host-` prefix, so the cookie name is `nestself_csrf`.
 */
const CSRF_COOKIE_NAME = 'nestself_csrf';

/**
 * Read the CSRF double-submit token from the request context's cookie jar.
 * Returns the raw token string, or throws if the cookie is not present.
 */
async function extractCsrfToken(
  request: APIRequestContext,
): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((c) => c.name === CSRF_COOKIE_NAME);
  if (!cookie) {
    const names = state.cookies.map((c) => c.name).join(', ');
    throw new Error(
      `CSRF cookie "${CSRF_COOKIE_NAME}" not found after sign-in. ` +
        `Available cookies: [${names}]`,
    );
  }
  return cookie.value;
}

// ---------------------------------------------------------------------------
// API response helper
// ---------------------------------------------------------------------------

/** Assert an API response succeeded and return the JSON body. */
async function ok<T = unknown>(
  resp: Awaited<ReturnType<APIRequestContext['post']>>,
  context: string,
): Promise<T> {
  if (!resp.ok()) {
    const text = await resp.text().catch(() => '(no body)');
    throw new Error(
      `${context} failed with HTTP ${resp.status()}: ${text}`,
    );
  }
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API-driven CMS workflow
// ---------------------------------------------------------------------------

export interface ArticleSetupResult {
  resourceId: string;
  /** Variant IDs keyed by locale. */
  variantIds: Record<string, string>;
  /** The latest revision IDs keyed by locale. */
  revisionIds: Record<string, string>;
  /** The uploaded media asset ID (if any). */
  assetId: string | null;
}

// -- Article body (Tiptap document) ----------------------------------------

interface BodyTexts {
  heading: string;
  paragraph: string;
  step: string;
  stepTitle: string;
}

const LOCALE_TEXTS: Record<string, BodyTexts> = {
  'sr-Latn': {
    heading: 'Upravljanje stresom na radnom mestu',
    paragraph:
      'Stres na poslu često se javlja neprimećeno i utiče na koncentraciju, ' +
      'raspoloženje i odnose sa kolegama. Važno je prepoznati znakove i ' +
      'pravovremeno reagovati.',
    step:
      'Napravite pauzu od pet minuta svaka dva sata: ustanite, prošetajte ' +
      'ili jednostavno zatvorite oči i dišite duboko.',
    stepTitle: 'Redovna pauza za disanje',
  },
  hu: {
    heading: 'A munkahelyi stressz kezelése',
    paragraph:
      'A munkahelyi stressz észrevétlenül alakul ki, és hatással van az ' +
      'összpontosításra, a hangulatra és a kollégákkal való kapcsolatokra. ' +
      'Fontos, hogy felismerjük a jeleket, és időben reagáljunk.',
    step:
      'Tartson ötperces szünetet kétóránként: álljon fel, sétáljon egy ' +
      'kicsit, vagy egyszerűen csukja be a szemét, és lélegezzen mélyen.',
    stepTitle: 'Rendszeres légzőszünet',
  },
  en: {
    heading: 'Managing workplace stress',
    paragraph:
      'Workplace stress often develops unnoticed and affects concentration, ' +
      'mood, and relationships with colleagues. Recognising the signs and ' +
      'responding in time is important.',
    step:
      'Take a five-minute break every two hours: stand up, walk around, ' +
      'or simply close your eyes and breathe deeply.',
    stepTitle: 'Regular breathing break',
  },
};

function makeArticleBody(locale: string): Record<string, unknown> {
  const t = LOCALE_TEXTS[locale] ?? LOCALE_TEXTS.en!;
  return {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'sectionHeading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: t.heading }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: t.paragraph }],
      },
      {
        type: 'practicalStep',
        attrs: { stepNumber: 1, title: t.stepTitle },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: t.step }],
          },
        ],
      },
    ],
  };
}

// -- Locale-specific metadata -----------------------------------------------

const LOCALE_TITLES: Record<string, string> = {
  'sr-Latn': 'Upravljanje stresom na radnom mestu',
  hu: 'A munkahelyi stressz kezelése',
  en: 'Managing workplace stress',
};

const LOCALE_SUMMARIES: Record<string, string> = {
  'sr-Latn':
    'Praktični saveti za smanjenje stresa tokom radnog dana i očuvanje ravnoteže.',
  hu:
    'Gyakorlati tippek a munkahelyi stressz csökkentéséhez és az egyensúly megőrzéséhez.',
  en:
    'Practical tips for reducing stress during the workday and maintaining balance.',
};

const LOCALE_OUTCOMES: Record<string, string> = {
  'sr-Latn':
    'Naučićete tri tehnike za prepoznavanje i ublažavanje svakodnevnog stresa.',
  hu:
    'Megtanul három technikát a mindennapi stressz felismerésére és enyhítésére.',
  en:
    'You will learn three techniques for recognising and easing everyday stress.',
};

// -- Response shapes --------------------------------------------------------

/** Shape returned by `POST /api/ops/cms/resources` (getResourceDetail). */
interface ResourceDetailResponse {
  id: string;
  variants: Array<{
    id: string;
    locale: string;
    revisions: Array<{
      id: string;
      lockVersion: number;
      contentVariantId: string;
    }>;
  }>;
}

/** Shape returned by `POST /api/ops/cms/resources/:id/variants` (getRevision). */
interface AddVariantResponse {
  id: string;
  contentVariantId: string;
  lockVersion: number;
}

/**
 * Create an article, fill all three locales, submit and approve each,
 * then publish for organization A. Driven entirely through the API.
 *
 * This replaces the admin UI path until the editor is wired to API mode.
 */
export async function setupArticleViaApi(
  request: APIRequestContext,
): Promise<ArticleSetupResult> {
  // ── 1. Sign in as author and create resource ───────────────────────
  let csrf = await signInStaffApi(request, USERS.author);

  const createBody = await ok<ResourceDetailResponse>(
    await request.post(`${API_URL}/api/ops/cms/resources`, {
      data: {
        type: 'article',
        primaryCategoryId: 'cat_stress',
        reviewPolicy: 'editorial',
        reviewDiscipline: 'psychological',
        locale: 'sr-Latn',
        title: LOCALE_TITLES['sr-Latn'],
      },
      headers: { 'X-CSRF-Token': csrf },
    }),
    'Create resource',
  );

  const resourceId = createBody.id;

  const variantIds: Record<string, string> = {};
  const revisionIds: Record<string, string> = {};
  const lockVersions: Record<string, number> = {};

  // The create response embeds variants with nested revisions.
  for (const v of createBody.variants) {
    variantIds[v.locale] = v.id;
    const rev = v.revisions[0];
    if (rev) {
      revisionIds[v.locale] = rev.id;
      lockVersions[v.locale] = rev.lockVersion;
    }
  }

  // ── 2. Add hu and en variants ──────────────────────────────────────
  for (const locale of ['hu', 'en'] as const) {
    if (!variantIds[locale]) {
      const addBody = await ok<AddVariantResponse>(
        await request.post(
          `${API_URL}/api/ops/cms/resources/${resourceId}/variants`,
          { data: { locale, fromLocale: 'sr-Latn' }, headers: { 'X-CSRF-Token': csrf } },
        ),
        `Add variant ${locale}`,
      );
      // addVariant returns the new revision (getRevision), not a variant.
      variantIds[locale] = addBody.contentVariantId;
      revisionIds[locale] = addBody.id;
      lockVersions[locale] = addBody.lockVersion;
    }
  }

  // ── 3. Fill each locale's working revision ─────────────────────────
  // PUT with If-Match, proposedAudience, no top-level cta.
  for (const locale of ['sr-Latn', 'hu', 'en'] as const) {
    const variantId = variantIds[locale]!;
    const revisionId = revisionIds[locale]!;
    const lv = lockVersions[locale]!;

    const saveBody = await ok<{ lockVersion: number }>(
      await request.put(
        `${API_URL}/api/ops/cms/variants/${variantId}/revisions/${revisionId}`,
        {
          data: {
            title: LOCALE_TITLES[locale],
            summary: LOCALE_SUMMARIES[locale],
            outcome: LOCALE_OUTCOMES[locale],
            durationSeconds: 600,
            body: makeArticleBody(locale),
            proposedAudience: [{ kind: 'organization', orgId: 'org_sample' }],
          },
          headers: { 'If-Match': `"${lv}"`, 'X-CSRF-Token': csrf },
        },
      ),
      `Save revision ${locale}`,
    );
    lockVersions[locale] = saveBody.lockVersion;
  }

  // ── 4. Submit each locale ──────────────────────────────────────────
  for (const locale of ['sr-Latn', 'hu', 'en'] as const) {
    const revisionId = revisionIds[locale]!;
    await ok(
      await request.post(
        `${API_URL}/api/ops/cms/revisions/${revisionId}/submit`,
        { headers: { 'X-CSRF-Token': csrf } },
      ),
      `Submit ${locale}`,
    );
  }

  // ── 5. Approve each locale (as reviewer, not the last editor) ──────
  await request.post(`${API_URL}/api/auth/sign-out`, {
    headers: { 'X-CSRF-Token': csrf },
  });
  csrf = await signInStaffApi(request, USERS.reviewer);

  for (const locale of ['sr-Latn', 'hu', 'en'] as const) {
    const revisionId = revisionIds[locale]!;
    await ok(
      await request.post(
        `${API_URL}/api/ops/cms/revisions/${revisionId}/approve`,
        { data: {}, headers: { 'X-CSRF-Token': csrf } },
      ),
      `Approve ${locale}`,
    );
  }

  // ── 6. Publish (as publisher) ──────────────────────────────────────
  await request.post(`${API_URL}/api/auth/sign-out`, {
    headers: { 'X-CSRF-Token': csrf },
  });
  csrf = await signInStaffApi(request, USERS.publisher);

  const publishBody = await ok<{ publications: unknown[] }>(
    await request.post(`${API_URL}/api/ops/cms/publications`, {
      data: {
        resourceId,
        audience: [{ kind: 'organization', orgId: 'org_sample' }],
      },
      headers: { 'X-CSRF-Token': csrf },
    }),
    'Publish',
  );

  expect(publishBody.publications.length).toBeGreaterThan(0);

  // Sign out publisher
  await request.post(`${API_URL}/api/auth/sign-out`, {
    headers: { 'X-CSRF-Token': csrf },
  });

  return { resourceId, variantIds, revisionIds, assetId: null };
}

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

const SCREENSHOT_BASE = path.resolve(
  import.meta.dirname,
  '../../docs/cms-ee/manual/screenshots',
);

export function screenshotPath(role: string, name: string): string {
  const dir = path.join(SCREENSHOT_BASE, role);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the page to show meaningful content (not just a loading spinner).
 */
export async function waitForContent(page: Page): Promise<void> {
  // Wait for network to settle and at least one heading to appear
  await page.waitForLoadState('domcontentloaded');
  await page.locator('h1, h2, [role="heading"]').first().waitFor({ timeout: 15_000 });
}

/**
 * Sign out from the workspace app.
 */
export async function signOutWorkspace(page: Page): Promise<void> {
  // Try the sign-out button or link, fall back to API call
  const signOutButton = page.getByRole('button', { name: 'Sign out' });
  const signOutLink = page.getByRole('link', { name: 'Sign out' });

  if (await signOutButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await signOutButton.click();
  } else if (await signOutLink.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await signOutLink.click();
  } else {
    // Navigate to settings where sign-out usually lives
    await page.goto(`${WORKSPACE_URL}/settings`);
    await page.waitForLoadState('domcontentloaded');
    const settingsSignOut = page.getByRole('button', { name: 'Sign out' });
    if (await settingsSignOut.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await settingsSignOut.click();
    } else {
      // API fallback
      await page.evaluate(() =>
        fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' }),
      );
      await page.goto(`${WORKSPACE_URL}/sign-in`);
    }
  }

  await page.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 10_000 });
}
