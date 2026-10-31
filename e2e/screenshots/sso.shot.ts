/**
 * Screenshots of enterprise SSO for the auth guides: the admin SSO page
 * (list, a connection's detail with a pending domain's DNS record, the
 * create dialog) and what an employee of that employer sees on the
 * workspace sign-in (the redirect interstitial, the denied message, and the
 * confirm-email step after an OIDC provider that did not confirm the
 * address).
 *
 * Runs after admin.shot.ts (files run in name order), which enrolled Nikola's
 * authenticator against this API process; `signInWithPassword` answers the
 * authenticator screen with the persisted secret, or enrols when this file
 * runs alone.
 *
 * Everything is fictional and lives in the disposable e2e database (global
 * setup removes it with the next reset). Through the stub API, as the
 * seeded users:
 * - Ivana (HR) invites `it.tester@acme.example`;
 * - Nikola (staff, the `platform_owner` grant admin.shot.ts also stages)
 *   creates the SAML connection `org-acme-saml` for the sample organization
 *   from the test-only metadata fixture (self-signed certificate, keys
 *   discarded), adds and verifies `acme.example` (`FAKE_DNS_TXT_AUTOVERIFY`
 *   on the stub API), starts the test, and the tester completes the
 *   single-use test sign-in through the fake identity provider; Nikola then
 *   activates the connection, adds `eu.acme.example` (left pending, so its
 *   TXT record shows) and creates a draft OIDC connection `org-acmeid-oidc`
 *   with its client secret staged.
 * The create dialog is captured open (the organisation found with the search
 * field, the OIDC protocol, the verified-email-claim switch) and cancelled;
 * the workspace discovery answer is real, but its start URL is swapped for
 * `javascript:void(0)` so the interstitial stays on screen.
 *
 * Once the admin pages are captured, Nikola completes the OIDC draft
 * (`acmeid.example`, activation) and starts its test from the page: the
 * Test sign-in button mints the single-use link and shows it with its note
 * (captured), and `it.tester@acmeid.example` signs in through that very link.
 * `maria@acmeid.example` then signs in through the connection with the fake
 * identity provider asserting her address unverified: the page she lands on
 * is the confirm-email step with the masked address (the stub API mailed a
 * code to nobody; nothing is bound until a code is entered, and none is).
 */
import { test, expect } from '@playwright/test';
import { SAMPLE_SAML_METADATA } from '../../apps/api/src/identity/saml-metadata.fixture.ts';
import {
  createOidcConnection,
  pageApi,
  removeDeveloperAccount,
  signInAtIdpAs,
  signInWithEmailCode,
  signInWithPassword,
  stagePlatformGrant,
} from '../auth/support';
import { ADMIN_URL, WORKSPACE_URL, pick, shot } from './shots';

const ORG = 'org_sample';
const ORG_NAME = 'Example d.o.o.';
const TESTER = 'it.tester@acme.example';
/** The OIDC connection's test sign-in (an address the IdP confirms) and the employee whose address it does not. */
const OIDC_TESTER = 'it.tester@acmeid.example';
const MARIA = 'maria@acmeid.example';

test.describe.configure({ mode: 'serial' });

test('enterprise SSO: admin connections page and the employee sign-in', async ({ browser }) => {
  await removeDeveloperAccount();
  await stagePlatformGrant('grant_user_nikola_platform_owner_screenshots', 'user_nikola', 'platform_owner');

  // Ivana invites the people who complete the test sign-ins, and Maria.
  const hr = await browser.newContext();
  const hrPage = await hr.newPage();
  await signInWithEmailCode(hrPage, WORKSPACE_URL, 'user_ivana@example.com');
  for (const email of [TESTER, OIDC_TESTER, MARIA]) {
    const invited = await pageApi(hrPage, 'POST', `/api/orgs/${ORG}/invitations`, { email, templateKey: 'employee' });
    expect([201, 409], JSON.stringify(invited.body)).toContain(invited.status);
  }
  await hr.close();

  // Nikola sets up, tests and activates the SAML connection.
  const staff = await browser.newContext();
  const page = await staff.newPage();
  await signInWithPassword(page, ADMIN_URL, 'user_nikola');
  const created = await pageApi(page, 'POST', '/api/ops/sso-connections', {
    orgId: ORG,
    slug: 'acme',
    protocol: 'SAML',
    metadataXml: SAMPLE_SAML_METADATA,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  const domain = await pageApi(page, 'POST', `/api/ops/sso-connections/${id}/domains`, { domain: 'acme.example' });
  expect(domain.status, JSON.stringify(domain.body)).toBe(201);
  const verified = await pageApi(page, 'POST', `/api/ops/sso-connections/${id}/domains/${domain.body.id}/verify`);
  expect(verified.status, JSON.stringify(verified.body)).toBe(200);
  const tested = await pageApi(page, 'POST', `/api/ops/sso-connections/${id}/test`);
  expect(tested.status, JSON.stringify(tested.body)).toBe(200);

  const tester = await browser.newContext();
  await signInAtIdpAs(tester, TESTER);
  const testerPage = await tester.newPage();
  await testerPage.goto(tested.body.startUrl as string);
  await expect(testerPage).toHaveURL(new RegExp(`^${WORKSPACE_URL}/(\\?.*)?$`), { timeout: 15_000 });
  await tester.close();

  const activated = await pageApi(page, 'POST', `/api/ops/sso-connections/${id}/activate`);
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  const pending = await pageApi(page, 'POST', `/api/ops/sso-connections/${id}/domains`, { domain: 'eu.acme.example' });
  expect(pending.status, JSON.stringify(pending.body)).toBe(201);
  // A draft with its client secret staged, so it can be tested after the captures.
  const draft = await createOidcConnection(
    page,
    { orgId: ORG, slug: 'acmeid', oidcIssuer: 'https://login.acme.example', oidcClientId: 'nestself-sample-client' },
    'sample-acmeid-secret',
  );
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);

  // The list.
  await page.goto(`${ADMIN_URL}/sso`);
  await expect(page.getByRole('heading', { level: 1, name: 'Single sign-on' })).toBeVisible({ timeout: 15_000 });
  const row = page.getByTestId(`sso-row-${id}`);
  await expect(row).toContainText('Active', { timeout: 15_000 });
  await expect(page.getByTestId(`sso-row-${draft.body.id as string}`)).toContainText('Draft');
  await shot(page, 'admin-sso-connections');

  // The detail panel, scrolled to the domains with the pending TXT record.
  await row.getByRole('button', { name: 'Details' }).click();
  const detail = page.getByRole('region', { name: 'Connection org-acme-saml' });
  await expect(detail).toBeVisible();
  const domains = detail.getByRole('heading', { level: 3, name: 'Domains' });
  await expect(detail.getByText('_nestself-verify.eu.acme.example')).toBeVisible();
  await expect(detail.getByText('urn:amazon:cognito:sp:eu-central-1_EXAMPLE')).toBeVisible();
  await domains.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'admin-sso-connection-detail');

  // The create dialog, filled in and cancelled (nothing is created). The
  // organisation is found with the search field (a server-side prefix match,
  // debounced) and picked from the matches.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'New connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'New SSO connection' });
  await expect(dialog).toBeVisible();
  const searched = page.waitForResponse((r) => r.url().includes('/api/ops/organizations') && r.url().includes('search=Exa'));
  await dialog.getByRole('searchbox', { name: 'Search organisations' }).fill('Exa');
  await searched;
  await pick(page, dialog, 'Organisation', ORG_NAME);
  await dialog.getByRole('radio', { name: 'OIDC' }).click();
  await dialog.getByLabel('Slug').fill('acmeuk');
  await dialog.getByLabel('Issuer URL').fill('https://login.acme.example/uk');
  await dialog.getByLabel('Client ID').fill('nestself-sample-client-uk');
  // The dialog scrolls inside the 800 px viewport, which would cut the claim
  // switch off below the search field: this one capture lifts the height cap
  // and takes a taller frame, so the whole OIDC form is in it.
  await page.setViewportSize({ width: 1280, height: 1500 });
  await dialog.evaluate((el) => {
    el.style.maxHeight = 'none';
  });
  await expect(dialog.getByRole('switch', { name: 'Require a verified email claim from the provider' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shot(page, 'admin-sso-create-connection');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });

  // Nikola completes the OIDC draft for the confirm-email capture.
  const oidcId = draft.body.id as string;
  const oidcDomain = await pageApi(page, 'POST', `/api/ops/sso-connections/${oidcId}/domains`, { domain: 'acmeid.example' });
  expect(oidcDomain.status, JSON.stringify(oidcDomain.body)).toBe(201);
  const oidcVerified = await pageApi(page, 'POST', `/api/ops/sso-connections/${oidcId}/domains/${oidcDomain.body.id}/verify`);
  expect(oidcVerified.status, JSON.stringify(oidcVerified.body)).toBe(200);

  // The test starts from the page: the button mints the single-use link and
  // shows it with its note, for staff to open or copy (it opens no tab itself).
  await page.goto(`${ADMIN_URL}/sso`);
  const oidcRow = page.getByTestId(`sso-row-${oidcId}`);
  await expect(oidcRow).toContainText('1 of 1 verified', { timeout: 15_000 });
  await oidcRow.getByRole('button', { name: 'Details' }).click();
  const oidcDetail = page.getByRole('region', { name: 'Connection org-acmeid-oidc' });
  await oidcDetail.getByRole('button', { name: 'Test sign-in' }).click();
  const testLink = oidcDetail.getByRole('link', { name: 'Open the test sign-in' });
  await expect(testLink).toBeVisible({ timeout: 15_000 });
  await expect(oidcDetail.getByText('Single use, valid 15 minutes.')).toBeVisible();
  const oidcStartUrl = (await testLink.getAttribute('href')) ?? '';
  expect(new URL(oidcStartUrl).searchParams.get('test')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // The toast closes itself; the capture is of the panel.
  await expect(page.getByRole('region', { name: 'Notifications' })).toBeEmpty({ timeout: 15_000 });
  await oidcDetail.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'admin-sso-test-link');

  const oidcTester = await browser.newContext();
  await signInAtIdpAs(oidcTester, OIDC_TESTER);
  const oidcTesterPage = await oidcTester.newPage();
  await oidcTesterPage.goto(oidcStartUrl);
  await expect(oidcTesterPage).toHaveURL(new RegExp(`^${WORKSPACE_URL}/(\\?.*)?$`), { timeout: 15_000 });
  await oidcTester.close();
  const oidcActivated = await pageApi(page, 'POST', `/api/ops/sso-connections/${oidcId}/activate`);
  expect(oidcActivated.status, JSON.stringify(oidcActivated.body)).toBe(200);
  await staff.close();

  // An employee on acme.example: the real discovery answer is `sso`. Its
  // `ssoStartUrl` is swapped for `javascript:void(0)` so that
  // `window.location.assign` does not leave the page and the interstitial
  // stays on screen (Playwright cannot inspect a page whose navigation is
  // pending).
  const employee = await browser.newContext();
  await employee.route((url) => url.pathname === '/api/auth/discover', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { method?: string; ssoStartUrl?: string };
    expect(body.method).toBe('sso');
    await route.fulfill({ response, json: { ...body, ssoStartUrl: 'javascript:void(0)' } });
  });
  const ws = await employee.newPage();
  await ws.goto(`${WORKSPACE_URL}/sign-in`);
  await expect(ws.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await ws.getByLabel('Email address').fill('employee@acme.example');
  await ws.getByRole('button', { name: 'Continue' }).click();
  await expect(ws.getByText("Redirecting to your organisation's sign-in…")).toBeVisible({ timeout: 10_000 });
  await shot(ws, 'workspace-sign-in-sso-redirect');

  // The neutral message after the identity provider signed in someone
  // NestSelf cannot bind (no invitation, JIT off).
  await ws.goto(`${WORKSPACE_URL}/sign-in?reason=sso_denied`);
  await expect(ws.getByRole('alert').getByText(/Your organisation has not enabled your account yet\./)).toBeVisible();
  await shot(ws, 'workspace-sign-in-sso-denied');
  await employee.close();

  // Maria signs in through the OIDC connection; the identity provider does
  // not confirm her address, so the sign-in waits for the email code.
  const maria = await browser.newContext();
  await signInAtIdpAs(maria, MARIA, { emailVerified: false });
  const mariaPage = await maria.newPage();
  await mariaPage.goto(`${WORKSPACE_URL}/sign-in`);
  await mariaPage.getByLabel('Email address').fill(MARIA);
  await mariaPage.getByRole('button', { name: 'Continue' }).click();
  await expect(mariaPage.getByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeVisible({ timeout: 20_000 });
  await expect(mariaPage.getByText(/did not confirm m\*\*\*@acmeid\.example/)).toBeVisible({ timeout: 10_000 });
  await shot(mariaPage, 'workspace-sign-in-sso-confirm-email');
  await maria.close();
});
