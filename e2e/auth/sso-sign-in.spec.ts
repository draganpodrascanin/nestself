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
 *    `invited@acme.example` with the employee template, through the API from
 *    her workspace page.
 * 2. Nikola (staff, platform_owner staged) creates the SAML connection for
 *    org_sample, adds and verifies acme.example, and starts the test.
 * 3. The tester completes the test sign-in (`test=<nonce>`): bound through the
 *    invitation, lands on the workspace, `lastTestedAt` is set.
 * 4. Nikola activates the connection.
 * 5. `invited@acme.example` enters the address on the workspace sign-in,
 *    is redirected through the fake IdP and lands on the home page.
 *
 * Re-runs: global setup reseeds the database; the fake IdP may still know
 * `org-acme-saml` from a previous run against the same API process, which the
 * test step handles (it updates an existing provider).
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_URL,
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

test.describe('Federated sign-in through the identity provider', () => {
  test.beforeAll(async () => {
    await stagePlatformGrant('grant_user_nikola_platform_owner_e2e', 'user_nikola', 'platform_owner');
  });

  test('staff set up and test a connection; an invited employee signs in through the IdP', async ({ browser }) => {
    // 1. Ivana invites the tester and the employee.
    const hr = await browser.newContext();
    const hrPage = await hr.newPage();
    await signInWithEmailCode(hrPage, WORKSPACE_URL, 'user_ivana@example.com');
    for (const email of [TESTER, INVITED]) {
      const res = await api(hrPage, 'POST', `/api/orgs/${ORG}/invitations`, { email, templateKey: 'employee' });
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
  });
});
