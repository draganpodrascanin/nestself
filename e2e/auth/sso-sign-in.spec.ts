/**
 * Federated sign-in journey (auth phase 3): staff set up an SSO connection
 * through the API, a test sign-in through the fake identity provider marks
 * it tested, staff activate it, and an invited employee of `acme.example`
 * signs in on the workspace through home-realm discovery and the fake IdP.
 *
 * Stub stack only: `FAKE_DNS_TXT_AUTOVERIFY=true` (playwright.auth.config.ts)
 * makes the domain verification pass, and `GET /api/auth/sso/_fake/authorize`
 * stands in for Cognito plus the employer IdP. The start redirect to that
 * route gets `as=<email>` appended (see `signInAtIdpAs`), which picks (or
 * creates, verified) the federated user who "signs in at the employer".
 *
 * Steps:
 * 1. Ivana (HR admin, email code) invites `it.tester@acme.example` and
 *    `invited@acme.example` with the employee template, and
 *    `it.admin@acme.example` with the hr_admin template, through the API from
 *    her workspace page.
 * 2. Nikola (staff, platform_owner staged) creates the SAML connection for
 *    org_sample, adds and verifies acme.example, and starts the test.
 * 3. The tester completes the test sign-in (`test=<nonce>`): bound through the
 *    invitation, lands on the workspace, `lastTestedAt` is set.
 * 4. Nikola activates the connection.
 * 5. `invited@acme.example` enters the address on the workspace sign-in,
 *    is redirected through the fake IdP and lands on the home page.
 * 6. `it.admin@acme.example` signs in the same way and ends that employee's
 *    membership on `/hr/people` (`people.deactivate`, the hr_admin
 *    template's step-up action; only the employer owner may assign templates
 *    on `/hr/access`). The session is fresh, so the first end request is
 *    answered in the browser with the API's own 403 `step_up_required`, as
 *    the server would after 30 minutes. The real dialog then starts a real
 *    step-up: a federated user has no native identity, so NestSelf mails the
 *    code to the identity's address, the dialog names it masked, and the stub
 *    API fixes the code to `123456` as the fake IdP does. The retried request
 *    ends the membership.
 *
 * Re-runs: global setup reseeds the database; the fake IdP may still know
 * `org-acme-saml` from a previous run against the same API process, which the
 * test step handles (it updates an existing provider).
 *
 * The second journey is an OIDC provider that does not confirm the address
 * (SSO-R-08; Entra ID omits `email_verified` by default):
 * 1. Ivana invites `oidc.tester@acmeid.example` and `maria@acmeid.example`.
 * 2. Nikola creates the OIDC connection `org-acmeid-oidc` with its client
 *    secret (`createOidcConnection`: a staged registration, or the provider
 *    the fake IdP kept from an earlier run against the same API process),
 *    verifies `acmeid.example` and starts the test. The tester's address is
 *    not confirmed by the IdP either, so the test sign-in also waits for the
 *    email code; the tester types `123456`, which binds, signs in and marks
 *    the TESTING connection tested, and Nikola activates it.
 * 3. Maria signs in on the workspace; the fake IdP asserts her address with
 *    `email_verified=false`. The callback keeps the sign-in pending and sends
 *    her to `/sign-in?reason=sso_email_unverified&bind=<handle>`, never with
 *    the address. The page names the masked address, she types the code
 *    NestSelf mailed (the stub API fixes it to `123456`) and lands on the
 *    workspace home.
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_URL,
  FIXED_OTP,
  WORKSPACE_URL,
  createOidcConnection,
  pageApi as api,
  signInAtIdpAs,
  signInWithEmailCode,
  signInWithPassword,
  stagePlatformGrant,
} from './support';

const ORG = 'org_sample';
const TESTER = 'it.tester@acme.example';
const INVITED = 'invited@acme.example';
/** Bound through an hr_admin invitation; display name `it.admin`. */
const IT_ADMIN = 'it.admin@acme.example';
/**
 * The OIDC journey: the IdP confirms neither address. The tester's address is
 * its own, not the screenshot run's `it.tester@acmeid.example` (signed in
 * confirmed), because an API process reused between the two runs keeps the
 * fake IdP's users and their state.
 */
const OIDC_TESTER = 'oidc.tester@acmeid.example';
const MARIA = 'maria@acmeid.example';

test.describe('Federated sign-in through the identity provider', () => {
  test.beforeAll(async () => {
    await stagePlatformGrant('grant_user_nikola_platform_owner_e2e', 'user_nikola', 'platform_owner');
  });

  test('staff set up and test a connection; invited people sign in through the IdP; a federated HR admin steps up', async ({ browser }) => {
    // 1. Ivana invites the tester, the employee and an HR administrator.
    const hr = await browser.newContext();
    const hrPage = await hr.newPage();
    await signInWithEmailCode(hrPage, WORKSPACE_URL, 'user_ivana@example.com');
    // HR admins start in their personal context; invitations are an organization action.
    const switched = await api(hrPage, 'POST', '/api/auth/context', { context: { kind: 'organization', orgId: ORG } });
    expect(switched.status, `switch to ${ORG}: ${JSON.stringify(switched.body)}`).toBe(200);
    const invitees: Array<[string, string]> = [[TESTER, 'employee'], [INVITED, 'employee'], [IT_ADMIN, 'hr_admin']];
    for (const [email, templateKey] of invitees) {
      const res = await api(hrPage, 'POST', `/api/orgs/${ORG}/invitations`, { email, templateKey });
      expect([201, 409], `invite ${email}: ${JSON.stringify(res.body)}`).toContain(res.status);
    }
    await hr.close();

    // 2. Nikola creates, verifies and tests the connection.
    const staff = await browser.newContext();
    const staffPage = await staff.newPage();
    await signInWithPassword(staffPage, ADMIN_URL, 'user_nikola');
    const created = await api(staffPage, 'POST', '/api/ops/sso-connections', {
      orgId: ORG,
      slug: 'acme',
      protocol: 'SAML',
      metadataUrl: 'https://idp.acme.example/metadata',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const domain = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/domains`, { domain: 'acme.example' });
    expect(domain.status, JSON.stringify(domain.body)).toBe(201);
    const verified = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/domains/${domain.body.id}/verify`);
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const tested = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/test`);
    expect(tested.status, JSON.stringify(tested.body)).toBe(200);
    const startUrl = tested.body.startUrl as string;
    // A single-use test nonce, not a literal flag.
    expect(new URL(startUrl).searchParams.get('test')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Not yet tested: activation is refused.
    const early = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/activate`);
    expect(early.status).toBe(409);

    // 3. The test sign-in binds the tester and marks the connection tested.
    const tester = await browser.newContext();
    await signInAtIdpAs(tester, TESTER);
    const testerPage = await tester.newPage();
    await testerPage.goto(startUrl);
    await expect(testerPage).toHaveURL(new RegExp(`^${WORKSPACE_URL}/(\\?.*)?$`), { timeout: 15_000 });
    await expect(testerPage.getByRole('heading', { name: /it\.tester/i })).toBeVisible({ timeout: 15_000 });
    await tester.close();

    // 4. Activate.
    const activated = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/activate`);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body.status).toBe('ACTIVE');
    expect(activated.body.lastTestedAt).not.toBeNull();
    await staff.close();

    // 5. The invited employee: identifier screen -> discover -> IdP -> home.
    const employee = await browser.newContext();
    await signInAtIdpAs(employee, INVITED);
    const page = await employee.newPage();
    await page.goto(`${WORKSPACE_URL}/sign-in`);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email address').fill(INVITED);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`^${WORKSPACE_URL}/(\\?.*)?$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /invited/i })).toBeVisible({ timeout: 15_000 });
    await employee.close();

    // 6. The federated HR administrator ends the employee's membership and steps up.
    const admin = await browser.newContext();
    await signInAtIdpAs(admin, IT_ADMIN);
    const adminPage = await admin.newPage();
    await adminPage.goto(`${WORKSPACE_URL}/sign-in`);
    await adminPage.getByLabel('Email address').fill(IT_ADMIN);
    await adminPage.getByRole('button', { name: 'Continue' }).click();
    await expect(adminPage).toHaveURL(new RegExp(`^${WORKSPACE_URL}/(\\?.*)?$`), { timeout: 20_000 });

    await adminPage.goto(`${WORKSPACE_URL}/hr/people`);
    await expect(adminPage.getByRole('heading', { level: 1, name: 'People' })).toBeVisible({ timeout: 15_000 });
    await adminPage.getByLabel('Search').fill(INVITED);
    const invitedRow = adminPage.getByRole('table', { name: 'Members' }).getByRole('row').filter({ hasText: 'invited' });
    await expect(invitedRow).toHaveCount(1, { timeout: 15_000 });
    await invitedRow.getByRole('button', { name: 'End the membership of invited' }).click();
    const end = adminPage.getByRole('alertdialog', { name: 'End membership' });
    await expect(end).toBeVisible();

    // The first end request answers step_up_required once (see the header).
    let stubbed = false;
    await adminPage.route(/\/api\/orgs\/[^/]+\/members\/[^/]+\/end$/, async (route) => {
      if (stubbed || route.request().method() !== 'POST') return route.fallback();
      stubbed = true;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'step_up_required',
          message: 'Re-authentication required for this action',
          details: { stepUpClass: 'administration', maxAge: 1800, method: 'email_otp' },
        }),
      });
    });
    const started = adminPage.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/auth/step-up/start'),
    );
    await end.getByRole('button', { name: 'End membership' }).click();

    const stepUp = adminPage.getByRole('dialog', { name: 'Verify your identity' });
    await expect(stepUp).toBeVisible({ timeout: 10_000 });
    const startResponse = await started;
    expect(startResponse.status()).toBe(200);
    expect(await startResponse.json()).toMatchObject({ method: 'email_otp', emailMasked: 'i***@acme.example' });
    await expect(stepUp).toContainText('We sent a verification code to i***@acme.example.');

    const stepUpVerified = adminPage.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/auth/step-up/verify'),
    );
    await stepUp.getByLabel('Verification code').fill(FIXED_OTP);
    await stepUp.getByRole('button', { name: 'Verify' }).click();
    expect((await stepUpVerified).status()).toBe(204);
    await expect(stepUp).toBeHidden({ timeout: 10_000 });

    // The retried request ended the membership.
    await expect(adminPage.getByText('The membership of invited has ended.').first()).toBeVisible({ timeout: 10_000 });
    expect(stubbed).toBe(true);
    await adminPage.unrouteAll({ behavior: 'ignoreErrors' });
    await admin.close();
  });

  test('an OIDC provider that does not confirm the address: the staff test and the employee finish with an email code', async ({ browser }) => {
    // 1. Ivana invites the tester and the employee.
    const hr = await browser.newContext();
    const hrPage = await hr.newPage();
    await signInWithEmailCode(hrPage, WORKSPACE_URL, 'user_ivana@example.com');
    for (const email of [OIDC_TESTER, MARIA]) {
      const res = await api(hrPage, 'POST', `/api/orgs/${ORG}/invitations`, { email, templateKey: 'employee' });
      expect([201, 409], `invite ${email}: ${JSON.stringify(res.body)}`).toContain(res.status);
    }
    await hr.close();

    // 2. Nikola creates, tests and activates the OIDC connection.
    const staff = await browser.newContext();
    const staffPage = await staff.newPage();
    await signInWithPassword(staffPage, ADMIN_URL, 'user_nikola');
    const created = await createOidcConnection(
      staffPage,
      { orgId: ORG, slug: 'acmeid', oidcIssuer: 'https://idp.acmeid.example', oidcClientId: 'client' },
      'e2e-acmeid-secret',
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.oidcEmailVerifiedClaimRequired).toBe(true);
    const id = created.body.id as string;
    const domain = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/domains`, { domain: 'acmeid.example' });
    expect(domain.status, JSON.stringify(domain.body)).toBe(201);
    const verified = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/domains/${domain.body.id}/verify`);
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const tested = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/test`);
    expect(tested.status, JSON.stringify(tested.body)).toBe(200);

    // Not tested yet: activation is refused.
    const early = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/activate`);
    expect(early.status).toBe(409);

    // The staff test sign-in, as with Entra ID: the IdP does not confirm the address, so it
    // waits for the email code, which binds the tester and marks the TESTING connection tested.
    const tester = await browser.newContext();
    await signInAtIdpAs(tester, OIDC_TESTER, { emailVerified: false });
    const testerPage = await tester.newPage();
    await testerPage.goto(tested.body.startUrl as string);
    await expect(testerPage.getByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeVisible({ timeout: 15_000 });
    expect(new URL(testerPage.url()).searchParams.get('bind')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(testerPage.getByText(/did not confirm o\*\*\*@acmeid\.example/)).toBeVisible({ timeout: 10_000 });
    await testerPage.getByLabel('Verification code').fill(FIXED_OTP);
    await testerPage.getByRole('button', { name: 'Confirm' }).click();
    await expect(testerPage).toHaveURL(new RegExp(`^${WORKSPACE_URL}/(\\?.*)?$`), { timeout: 15_000 });
    await expect(testerPage.getByRole('heading', { name: /oidc\.tester/i })).toBeVisible({ timeout: 15_000 });
    await tester.close();

    const activated = await api(staffPage, 'POST', `/api/ops/sso-connections/${id}/activate`);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body.status).toBe('ACTIVE');
    expect(activated.body.lastTestedAt).not.toBeNull();
    await staff.close();

    // 3. Maria: discovery -> IdP without email_verified -> the confirm-email step -> home.
    const employee = await browser.newContext();
    await signInAtIdpAs(employee, MARIA, { emailVerified: false });
    const page = await employee.newPage();
    const started = page.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/auth/sso/bind/start',
    );
    await page.goto(`${WORKSPACE_URL}/sign-in`);
    await page.getByLabel('Email address').fill(MARIA);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeVisible({ timeout: 20_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('reason')).toBe('sso_email_unverified');
    expect(url.searchParams.get('bind')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.has('email')).toBe(false);
    expect(decodeURIComponent(page.url())).not.toContain('acmeid.example');
    expect((await started).status()).toBe(200);
    await expect(
      page.getByText("Your organisation's sign-in did not confirm m***@acmeid.example. Enter the code we sent there."),
    ).toBeVisible();

    const confirmed = page.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/auth/sso/bind/verify',
    );
    await page.getByLabel('Verification code').fill(FIXED_OTP);
    await page.getByRole('button', { name: 'Confirm' }).click();
    const verify = await confirmed;
    expect(verify.status()).toBe(200);
    expect(await verify.json()).toEqual({ returnPath: '/' });

    await expect(page).toHaveURL(new RegExp(`^${WORKSPACE_URL}/(\\?.*)?$`), { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /maria/i })).toBeVisible({ timeout: 15_000 });
    await employee.close();
  });
});
