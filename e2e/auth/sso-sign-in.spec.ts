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
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_URL,
  FIXED_OTP,
  WORKSPACE_URL,
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

test.describe('Federated sign-in through the identity provider', () => {
  test.beforeAll(async () => {
    await stagePlatformGrant('grant_user_nikola_platform_owner_e2e', 'user_nikola', 'platform_owner');
  });

  test('staff set up and test a connection; invited people sign in through the IdP; a federated HR admin steps up', async ({ browser }) => {
    // 1. Ivana invites the tester, the employee and an HR administrator.
    const hr = await browser.newContext();
    const hrPage = await hr.newPage();
    await signInWithEmailCode(hrPage, WORKSPACE_URL, 'user_ivana@example.com');
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
});
