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

  it('totpEnrol sends the sign-in challengeToken', async () => {
    const { auth, last } = setup({ secretUri: 'otpauth://totp/NestSelf?secret=ABC', challengeToken: 'next' });
    const res = await auth.totpEnrol('tok-1');
    expect(res.challengeToken).toBe('next');
    expect(last()).toEqual({ url: 'http://x/api/auth/totp/enrol', method: 'POST', csrf: 'tok', body: { challengeToken: 'tok-1' } });
  });

  it('totpConfirm posts the code and parses { enrolled: true }', async () => {
    const { auth, last } = setup({ enrolled: true });
    await expect(auth.totpConfirm('123456')).resolves.toEqual({ enrolled: true });
    expect(last()).toEqual({ url: 'http://x/api/auth/totp/confirm', method: 'POST', csrf: 'tok', body: { code: '123456' } });
  });

  it('totpConfirm rejects a response that is not { enrolled: true }', async () => {
    const { auth } = setup({ enrolled: false });
    await expect(auth.totpConfirm('123456')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  const RESENT = { method: 'email_otp', challengeToken: 'tok-2', ssoStartUrl: null, emailMasked: 'i***@acme.example' };

  it('stepUpResend posts the challenge token to /api/auth/step-up/resend and parses the new challenge', async () => {
    const { auth, last } = setup(RESENT);
    await expect(auth.stepUpResend('tok-1')).resolves.toEqual(RESENT);
    expect(last()).toEqual({
      url: 'http://x/api/auth/step-up/resend',
      method: 'POST',
      csrf: 'tok',
      body: { challengeToken: 'tok-1' },
    });
  });

  it('stepUpResend rejects an answer without emailMasked', async () => {
    const { emailMasked: _omit, ...withoutMask } = RESENT;
    const { auth } = setup(withoutMask);
    await expect(auth.stepUpResend('tok-1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  const ACCEPTED = { method: 'email_otp', challengeToken: 'tok', ssoStartUrl: null, step: null };

  it('invitationAccept sends the locale of the code email with the token', async () => {
    const { auth, last } = setup(ACCEPTED);
    await auth.invitationAccept('inv-1', 'hu');
    expect(last()).toMatchObject({ url: 'http://x/api/invitations/accept', method: 'POST', body: { token: 'inv-1', locale: 'hu' } });
  });

  it('invitationAccept sends only the token when no locale is given', async () => {
    const { auth, last } = setup(ACCEPTED);
    await auth.invitationAccept('inv-1');
    expect(last().body).toEqual({ token: 'inv-1' });
  });
});

