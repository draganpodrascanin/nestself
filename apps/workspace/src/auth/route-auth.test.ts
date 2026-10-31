/**
 * The first `GET /auth/me`, as the route guards and the provider share it.
 * A 401 means "signed out"; any other failure means "the session is unknown"
 * and must never be mistaken for a sign-out (the guards would send the user
 * to /sign-in for a flaky connection).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, createApiClient } from '@nestself/api-client';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import {
  ME_TIMEOUT_MS,
  SessionUnavailableError,
  initialMe,
  initialSnapshot,
  releaseInitialMe,
  resolveRouteAuth,
} from './route-auth';

const ME = {
  principal: SAMPLE_PRINCIPALS.employee.principal,
  effectiveActions: [...SAMPLE_PRINCIPALS.employee.effectiveActions],
  availableContexts: [],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A cookie-mode client whose fetch answers with `answer`; `calls` keeps what each request carried. */
function clientAnswering(answer: (init: RequestInit | undefined, call: number) => Promise<Response>) {
  const calls: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), signal: init?.signal });
    return answer(init, calls.length);
  };
  return { client: createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }), calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initialSnapshot', () => {
  it('is the principal and the effective actions of a signed-in session', async () => {
    const { client, calls } = clientAnswering(async () => json(200, ME));

    await expect(initialSnapshot(client)).resolves.toEqual({
      principal: ME.principal,
      effectiveActions: ME.effectiveActions,
      availableContexts: [],
    });
    expect(calls.map((c) => c.url)).toEqual(['http://x/api/auth/me']);
  });

  it('is a signed-out snapshot when /auth/me answers 401', async () => {
    const { client } = clientAnswering(async () => json(401, { code: 'unauthenticated', message: 'No session' }));

    await expect(initialSnapshot(client)).resolves.toEqual({ principal: null, effectiveActions: [], availableContexts: [] });
  });

  it.each([403, 429, 500, 503])('throws SessionUnavailableError when /auth/me answers %i, not a signed-out snapshot', async (status) => {
    const { client } = clientAnswering(async () => json(status, { code: 'internal_error', message: 'English message' }));

    const failure = await initialSnapshot(client).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(SessionUnavailableError);
    expect((failure as SessionUnavailableError).cause).toBeInstanceOf(ApiError);
    expect(((failure as SessionUnavailableError).cause as ApiError).status).toBe(status);
  });

  it('throws SessionUnavailableError when the API cannot be reached', async () => {
    const { client } = clientAnswering(async () => {
      throw new TypeError('Failed to fetch');
    });

    const failure = await initialSnapshot(client).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(SessionUnavailableError);
    expect(((failure as SessionUnavailableError).cause as ApiError).code).toBe('network');
  });

  it('throws SessionUnavailableError when the answer is not a session', async () => {
    const { client } = clientAnswering(async () => json(200, { unexpected: true }));

    await expect(initialSnapshot(client)).rejects.toBeInstanceOf(SessionUnavailableError);
  });

  it('gives up after ME_TIMEOUT_MS when the API does not answer', async () => {
    // `AbortSignal.timeout` runs on a native timer that fake timers do not move:
    // hand the request a signal the test aborts itself, and check what was asked for.
    const timeout = new AbortController();
    const timeoutSignal = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const { client, calls } = clientAnswering(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation timed out.', 'TimeoutError')));
        }),
    );

    const snapshot = initialSnapshot(client);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(ME_TIMEOUT_MS).toBe(10_000);
    expect(timeoutSignal).toHaveBeenCalledWith(ME_TIMEOUT_MS);
    expect(calls[0]?.signal).toBe(timeout.signal);

    timeout.abort();

    await expect(snapshot).rejects.toBeInstanceOf(SessionUnavailableError);
  });
});

describe('initialMe', () => {
  it('is one request shared by the guards and the provider until the provider releases it', async () => {
    const { client, calls } = clientAnswering(async () => json(200, ME));

    const first = initialMe(client);
    const second = initialMe(client);
    await Promise.all([first, second]);

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it('asks again after the release: a retry is a new request, not the failure served again', async () => {
    const { client, calls } = clientAnswering(async (_init, call) =>
      call === 1 ? json(500, { code: 'internal_error', message: 'English message' }) : json(200, ME),
    );

    await expect(initialSnapshot(client)).rejects.toBeInstanceOf(SessionUnavailableError);
    // Until the provider has taken the result, everyone gets the same failed request.
    await expect(initialSnapshot(client)).rejects.toBeInstanceOf(SessionUnavailableError);
    expect(calls).toHaveLength(1);

    releaseInitialMe(client);

    await expect(initialSnapshot(client)).resolves.toMatchObject({ effectiveActions: ME.effectiveActions });
    expect(calls).toHaveLength(2);
  });
});

describe('resolveRouteAuth', () => {
  const SIGNED_IN = { principal: ME.principal, effectiveActions: ME.effectiveActions, availableContexts: [] };

  it('answers from the context when the provider already has the principal', async () => {
    const ensure = vi.fn();

    await expect(resolveRouteAuth({ ...SIGNED_IN, ensure })).resolves.toMatchObject(SIGNED_IN);

    expect(ensure).not.toHaveBeenCalled();
  });

  it('answers from the context when the provider has settled without a session', async () => {
    const ensure = vi.fn();

    await expect(resolveRouteAuth({ principal: null, effectiveActions: [], availableContexts: [], settled: true, ensure })).resolves.toMatchObject({
      principal: null,
    });

    expect(ensure).not.toHaveBeenCalled();
  });

  it('waits for the first session while the provider has no result', async () => {
    const ensure = vi.fn().mockResolvedValue(SIGNED_IN);

    await expect(resolveRouteAuth({ principal: null, effectiveActions: [], availableContexts: [], settled: false, ensure })).resolves.toEqual(SIGNED_IN);

    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('lets the guard fail with SessionUnavailableError instead of deciding on an unknown session', async () => {
    const ensure = vi.fn().mockRejectedValue(new SessionUnavailableError());

    await expect(resolveRouteAuth({ principal: null, effectiveActions: [], availableContexts: [], settled: false, ensure })).rejects.toBeInstanceOf(
      SessionUnavailableError,
    );
  });
});
