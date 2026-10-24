import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApiClient } from './client';
import { createAuthApi } from './auth';

/** Records the JSON body of the one request made, and answers a valid start response. */
function recordingFetch(): { fetch: typeof fetch; body: () => unknown } {
  let sent: string | undefined;
  const fetchFn: typeof fetch = async (_input, init) => {
    sent = init?.body as string;
    return new Response(JSON.stringify({ challengeToken: 'tok', codeDeliveryMedium: 'EMAIL' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchFn, body: () => JSON.parse(sent!) };
}

describe('createAuthApi().emailOtpStart', () => {
  it('sends the locale with the email when one is given', async () => {
    const rec = recordingFetch();
    const auth = createAuthApi(createApiClient({ baseUrl: 'http://localhost', mode: 'bearer', fetchImpl: rec.fetch }));

    await auth.emailOtpStart('a@b.co', 'sr-Cyrl');

    expect(rec.body()).toEqual({ email: 'a@b.co', locale: 'sr-Cyrl' });
  });

  it('sends only the email when no locale is given', async () => {
    const rec = recordingFetch();
    const auth = createAuthApi(createApiClient({ baseUrl: 'http://localhost', mode: 'bearer', fetchImpl: rec.fetch }));

    await auth.emailOtpStart('a@b.co');

    expect(rec.body()).toEqual({ email: 'a@b.co' });
  });
});

describe('createAuthApi() account methods', () => {
  const PRINCIPAL = {
    userId: 'u-1',
    displayName: 'Sample User',
    initials: 'SU',
    locale: 'hu',
    memberships: [],
    staffTemplates: [],
    expert: null,
    context: { kind: 'personal' },
    auth: { method: 'email_otp', time: '2026-10-25T00:00:00.000Z', secondFactor: false, lastStepUpAt: null },
    sessionId: 'sess-1',
    tokenFamily: null,
  };

  interface Call {
    url: string;
    method: string;
    csrf: string | null;
    body: unknown;
  }

  function setup(responseBody: unknown) {
    const calls: Call[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        csrf: new Headers(init?.headers).get('X-CSRF-Token'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const auth = createAuthApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
    return { auth, last: () => calls[calls.length - 1]! };
  }

  const originalDocument = globalThis.document;
  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', { value: { cookie: 'nestself_csrf=tok' }, configurable: true, writable: true });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true, writable: true });
  });

  it('updateLocale sends PATCH /api/auth/me/locale with CSRF and parses the principal', async () => {
    const { auth, last } = setup({ principal: PRINCIPAL, effectiveActions: [] });
    const res = await auth.updateLocale('hu');
    expect(res.principal.locale).toBe('hu');
    expect(last()).toEqual({ url: 'http://x/api/auth/me/locale', method: 'PATCH', csrf: 'tok', body: { locale: 'hu' } });
  });

  it('updateDisplayName sends PATCH /api/auth/me/display-name with CSRF', async () => {
    const { auth, last } = setup({ principal: { ...PRINCIPAL, displayName: 'New Name', initials: 'NN' }, effectiveActions: [] });
    const res = await auth.updateDisplayName('New Name');
    expect(res.principal.displayName).toBe('New Name');
    expect(last()).toEqual({
      url: 'http://x/api/auth/me/display-name',
      method: 'PATCH',
      csrf: 'tok',
      body: { displayName: 'New Name' },
    });
  });

  it('updateLocale rejects a response that is not a MeResponse', async () => {
    const { auth } = setup({ ok: true });
    await expect(auth.updateLocale('hu')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('totpEnrolSignedIn posts to /api/auth/me/totp/enrol without a challenge token', async () => {
    const { auth, last } = setup({ secretUri: 'otpauth://totp/NestSelf?secret=ABC', challengeToken: null });
    const res = await auth.totpEnrolSignedIn();
    expect(res).toEqual({ secretUri: 'otpauth://totp/NestSelf?secret=ABC', challengeToken: null });
    expect(last()).toEqual({ url: 'http://x/api/auth/me/totp/enrol', method: 'POST', csrf: 'tok', body: {} });
  });

  it('totpEnrolSignedIn rejects a response without secretUri', async () => {
    const { auth } = setup({ challengeToken: null });
    await expect(auth.totpEnrolSignedIn()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
