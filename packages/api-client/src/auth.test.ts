import { describe, it, expect } from 'vitest';
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
