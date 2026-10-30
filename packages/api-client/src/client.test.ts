import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './client';
import { ApiError } from './errors';
import { createCallsApi } from './calls';
import { retryUnlessClientError } from './queries/calls';

const TestSchema = z.object({ ok: z.boolean() });

function mockFetch(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'content-type': 'application/json', ...headers },
    });
}

function mockFetchEmpty(status: number): typeof fetch {
  return async () =>
    new Response(null, {
      status,
      statusText: status === 204 ? 'No Content' : 'OK',
    });
}

/** Captures the request init from a successful fetch. */
function capturingFetch(body: unknown = { ok: true }): {
  fetch: typeof fetch;
  captured: () => { headers: Headers; init: RequestInit };
} {
  let capturedHeaders: Headers | undefined;
  let capturedInit: RequestInit | undefined;

  const fetchFn: typeof fetch = async (_input, init) => {
    capturedInit = init;
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    fetch: fetchFn,
    captured: () => ({
      headers: capturedHeaders!,
      init: capturedInit!,
    }),
  };
}

describe('createApiClient', () => {
  it('resolves with parsed body on 200 + valid body', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: mockFetch(200, { ok: true }),
    });

    const result = await client.request('/api/test', { schema: TestSchema });
    expect(result).toEqual({ ok: true });
  });

  it('rejects with ApiError.status === 503 on non-2xx response', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: mockFetch(503, { status: 'error' }),
    });

    await expect(
      client.request('/api/health', { schema: TestSchema }),
    ).rejects.toThrow(ApiError);

    try {
      await client.request('/api/health', { schema: TestSchema });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(503);
    }
  });

  it('rejects with code "invalid_response" when body does not match schema', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: mockFetch(200, { unexpected: 'shape' }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('invalid_response');
    }
  });

  it('rejects with code "network" when fetch itself fails', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('network');
      expect((err as ApiError).status).toBe(0);
    }
  });

  it('sends Authorization bearer header when getToken returns a value', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      getToken: () => 'my-token',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(cap.captured().headers.get('Authorization')).toBe('Bearer my-token');
  });

  it('does not send Authorization header when getToken returns null', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      getToken: () => null,
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(cap.captured().headers.get('Authorization')).toBeNull();
  });

  it('reads x-request-id header into ApiError.requestId', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: mockFetch(500, { message: 'Internal error' }, {
        'x-request-id': 'req-123',
      }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).requestId).toBe('req-123');
    }
  });

  it('parses { message } from error body', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: mockFetch(400, { message: 'Bad request body' }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Bad request body');
    }
  });

  it('parses { error } from error body when message is absent', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: mockFetch(400, { error: 'Validation failed' }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Validation failed');
    }
  });

  it('exposes baseUrl on the client', () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
    });
    expect(client.baseUrl).toBe('http://localhost:4000');
  });
});

// ---------------------------------------------------------------------------
// Cookie mode (CLIENT-R-28)
// ---------------------------------------------------------------------------

describe('cookie mode', () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    // Provide a minimal document.cookie for CSRF tests
    Object.defineProperty(globalThis, 'document', {
      value: { cookie: 'nestself_csrf=test-csrf-token' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      writable: true,
      configurable: true,
    });
  });

  it('sets credentials "include" on every request', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'cookie',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(cap.captured().init.credentials).toBe('include');
  });

  it('sends X-CSRF-Token on POST requests', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'cookie',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', {
      method: 'POST',
      schema: TestSchema,
    });
    expect(cap.captured().headers.get('X-CSRF-Token')).toBe('test-csrf-token');
  });

  it('does not send X-CSRF-Token on GET requests', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'cookie',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', {
      method: 'GET',
      schema: TestSchema,
    });
    expect(cap.captured().headers.get('X-CSRF-Token')).toBeNull();
  });

  it('does not send Authorization header in cookie mode', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'cookie',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(cap.captured().headers.get('Authorization')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mode resolution and mixing (CLIENT-R-28)
// ---------------------------------------------------------------------------

describe('mode resolution', () => {
  it('defaults to bearer when getToken is provided', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      getToken: () => 'tok',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(cap.captured().headers.get('Authorization')).toBe('Bearer tok');
    expect(cap.captured().init.credentials).toBeUndefined();
  });

  it('defaults to cookie when getToken is not provided', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(cap.captured().init.credentials).toBe('include');
  });

  it('rejects cookie mode with getToken (mixing)', () => {
    expect(() =>
      createApiClient({
        baseUrl: 'http://localhost',
        mode: 'cookie',
        getToken: () => 'tok',
      }),
    ).toThrow(/cookie mode/i);
  });

  it('allows bearer mode without getToken (no auth header sent)', async () => {
    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'bearer',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(cap.captured().headers.get('Authorization')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ApiError.code from body (CLIENT-R-29)
// ---------------------------------------------------------------------------

describe('ApiError.code from body', () => {
  it('reads code from the body code field', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'bearer',
      fetchImpl: mockFetch(401, {
        status: 401,
        code: 'invalid_credentials',
        message: 'Wrong password',
        requestId: null,
      }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('invalid_credentials');
    }
  });

  it('falls back to status number as string when code is absent', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'bearer',
      fetchImpl: mockFetch(422, { message: 'Validation failed' }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('422');
    }
  });
});

// ---------------------------------------------------------------------------
// ApiError.details (CLIENT-R-29)
// ---------------------------------------------------------------------------

describe('ApiError.details', () => {
  it('reads details from the error body', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'bearer',
      fetchImpl: mockFetch(429, {
        status: 429,
        code: 'too_many_attempts',
        message: 'Too many attempts',
        requestId: null,
        details: { retryAfter: 60 },
      }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).details).toEqual({ retryAfter: 60 });
    }
  });

  it('details is undefined when not in the body', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'bearer',
      fetchImpl: mockFetch(400, { message: 'Bad' }),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).details).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Empty body / 204 handling
// ---------------------------------------------------------------------------

describe('204 / empty body handling', () => {
  it('returns undefined when expectBody is false', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'bearer',
      fetchImpl: mockFetchEmpty(204),
    });

    const result = await client.request('/api/auth/sign-out', {
      method: 'POST',
      schema: z.undefined(),
      expectBody: false,
    });
    expect(result).toBeUndefined();
  });

  it('throws when body is empty but expectBody is not false', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'bearer',
      fetchImpl: mockFetchEmpty(200),
    });

    try {
      await client.request('/api/test', { schema: TestSchema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('invalid_response');
    }
  });
});

// ---------------------------------------------------------------------------
// Custom CSRF cookie names
// ---------------------------------------------------------------------------

describe('custom CSRF cookie names', () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      writable: true,
      configurable: true,
    });
  });

  it('reads custom CSRF cookie name', async () => {
    Object.defineProperty(globalThis, 'document', {
      value: { cookie: 'my_csrf=custom-token' },
      writable: true,
      configurable: true,
    });

    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'cookie',
      csrfCookieNames: ['my_csrf'],
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', {
      method: 'POST',
      schema: TestSchema,
    });
    expect(cap.captured().headers.get('X-CSRF-Token')).toBe('custom-token');
  });

  it('tries __Host-nestself_csrf before nestself_csrf by default', async () => {
    Object.defineProperty(globalThis, 'document', {
      value: { cookie: '__Host-nestself_csrf=host-token; nestself_csrf=dev-token' },
      writable: true,
      configurable: true,
    });

    const cap = capturingFetch();

    const client = createApiClient({
      baseUrl: 'http://localhost',
      mode: 'cookie',
      fetchImpl: cap.fetch,
    });

    await client.request('/api/test', {
      method: 'POST',
      schema: TestSchema,
    });
    expect(cap.captured().headers.get('X-CSRF-Token')).toBe('host-token');
  });
});

// ---------------------------------------------------------------------------
// Calls API (T-CW-1.5): paths, bodies, no-store join, batching, no logging
// ---------------------------------------------------------------------------

describe('calls API', () => {
  const APPOINTMENT = {
    id: 'appt 1',
    orgId: 'org_1',
    expertUserId: 'user_expert',
    employeeUserId: 'user_employee',
    startsAt: '2030-01-15T09:00:00.000Z',
    endsAt: '2030-01-15T09:50:00.000Z',
    status: 'confirmed',
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: null,
  };

  const JOIN_RESPONSE = {
    sessionId: 'sess_1',
    participantId: 'part_1',
    role: 'employee',
    format: 'consultation',
    startsAt: APPOINTMENT.startsAt,
    endsAt: APPOINTMENT.endsAt,
    meeting: {
      MeetingId: 'meeting_1',
      MediaRegion: 'eu-central-1',
      MediaPlacement: { AudioHostUrl: 'audio:3478', AudioFallbackUrl: 'wss://fallback', SignalingUrl: 'wss://signal' },
    },
    attendee: { AttendeeId: 'att_1', ExternalUserId: 'part_1', JoinToken: 'secret-join-token' },
  };

  interface Sent {
    url: string;
    method: string;
    cache: RequestCache | undefined;
    body: unknown;
  }

  function callsApiWith(respond: (sent: Sent) => Response) {
    const sent: Sent[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const entry: Sent = {
        url: String(input),
        method: init?.method ?? 'GET',
        cache: init?.cache,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      sent.push(entry);
      return respond(entry);
    };
    const client = createApiClient({ baseUrl: 'http://x', mode: 'bearer', fetchImpl });
    return { api: createCallsApi(client), sent };
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const noContent = () => new Response(null, { status: 204 });

  it('lists appointments with the defined query parameters only', async () => {
    const { api, sent } = callsApiWith(() => json(200, { items: [APPOINTMENT], nextCursor: 'c2' }));
    const page = await api.listAppointments({ limit: 20, cursor: 'c1', status: 'proposed', orgId: undefined });
    expect(sent[0]).toMatchObject({ url: 'http://x/api/appointments?limit=20&cursor=c1&status=proposed', method: 'GET' });
    expect(page.nextCursor).toBe('c2');
    expect(page.items[0]?.id).toBe('appt 1');
  });

  it('reads one appointment by its encoded id', async () => {
    const { api, sent } = callsApiWith(() => json(200, APPOINTMENT));
    await api.getAppointment('appt 1');
    expect(sent[0]?.url).toBe('http://x/api/appointments/appt%201');
  });

  it('joins with an empty body, cache no-store, and returns the parsed credentials', async () => {
    const { api, sent } = callsApiWith(() => json(200, JOIN_RESPONSE));
    const response = await api.join('appt_1');
    expect(sent[0]).toEqual({ url: 'http://x/api/appointments/appt_1/join', method: 'POST', cache: 'no-store', body: {} });
    expect(response.attendee.JoinToken).toBe('secret-join-token');
  });

  it('sends the optional location text in the join body', async () => {
    const { api, sent } = callsApiWith(() => json(200, JOIN_RESPONSE));
    await api.join('appt_1', { locationText: 'Novi Sad, at home' });
    expect(sent[0]?.body).toEqual({ locationText: 'Novi Sad, at home' });
  });

  it('never logs the join response or its failure', async () => {
    const spies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    try {
      const ok = callsApiWith(() => json(200, JOIN_RESPONSE));
      await ok.api.join('appt_1');
      const failing = callsApiWith(() => json(403, { code: 'join_window_closed', message: 'closed' }));
      await expect(failing.api.join('appt_1')).rejects.toMatchObject({ status: 403, code: 'join_window_closed' });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('surfaces 409 appointment_not_joinable as an ApiError code', async () => {
    const { api } = callsApiWith(() => json(409, { code: 'appointment_not_joinable', message: 'nope' }));
    await expect(api.join('appt_1')).rejects.toMatchObject({ status: 409, code: 'appointment_not_joinable' });
  });

  it('ends the call, sends feedback and signals as 204 calls', async () => {
    const { api, sent } = callsApiWith(() => noContent());
    await expect(api.end('appt_1')).resolves.toBeUndefined();
    await api.submitFeedback('appt_1', { score: 4, comment: 'Clear audio' });
    await api.sendSignal('appt_1', { type: 'running_late', etaMinutes: 5 });
    expect(sent.map((s) => [s.method, s.url, s.body])).toEqual([
      ['POST', 'http://x/api/appointments/appt_1/end', undefined],
      ['POST', 'http://x/api/appointments/appt_1/feedback', { score: 4, comment: 'Clear audio' }],
      ['POST', 'http://x/api/appointments/appt_1/signal', { type: 'running_late', etaMinutes: 5 }],
    ]);
  });

  it('records an outcome with the enum only and returns the updated appointment', async () => {
    const { api, sent } = callsApiWith(() => json(200, { ...APPOINTMENT, status: 'completed' }));
    const updated = await api.recordOutcome('appt_1', { status: 'completed' });
    expect(sent[0]).toMatchObject({ url: 'http://x/api/appointments/appt_1/outcome', body: { status: 'completed' } });
    expect(updated.status).toBe('completed');
  });

  it('reads the shared location without caching', async () => {
    const { api, sent } = callsApiWith(() => json(200, { locationText: null }));
    await expect(api.getLocation('appt_1')).resolves.toEqual({ locationText: null });
    expect(sent[0]).toMatchObject({ url: 'http://x/api/appointments/appt_1/location', method: 'GET', cache: 'no-store' });
  });

  it('posts client events per session in batches of at most 50', async () => {
    const { api, sent } = callsApiWith(() => noContent());
    const events = Array.from({ length: 120 }, () => ({ eventName: 'connectionStats' as const, metrics: { rtt: 40 } }));
    await api.postClientEvents('sess_1', events);
    expect(sent.map((s) => s.url)).toEqual(Array(3).fill('http://x/api/calls/sess_1/client-events'));
    expect(sent.map((s) => (s.body as { events: unknown[] }).events.length)).toEqual([50, 50, 20]);
  });

  it('sends nothing for an empty client-event list', async () => {
    const { api, sent } = callsApiWith(() => noContent());
    await api.postClientEvents('sess_1', []);
    expect(sent).toHaveLength(0);
  });

  it('calls the follow-up routes with their contract bodies', async () => {
    const { api, sent } = callsApiWith(() => json(200, { ...APPOINTMENT, status: 'proposed' }));
    await api.proposeFollowUp('appt_1', { startsAt: '2030-02-01T09:00:00.000Z', durationMinutes: 50, timeZone: 'Europe/Belgrade' });
    await api.confirmFollowUp('appt_2');
    await api.suggestFollowUpTimes('appt_2', { windows: [{ startsAt: '2030-02-02T09:00:00.000Z', endsAt: '2030-02-02T10:00:00.000Z' }] });
    await api.scheduleFollowUp('appt_2', { selectedWindowIndex: 0 });
    await api.declineFollowUp('appt_2');
    await api.cancel('appt_3');
    expect(sent.map((s) => [s.url.replace('http://x/api/appointments/', ''), s.body])).toEqual([
      ['appt_1/follow-up', { startsAt: '2030-02-01T09:00:00.000Z', durationMinutes: 50, timeZone: 'Europe/Belgrade' }],
      ['appt_2/confirm', {}],
      ['appt_2/suggest-times', { windows: [{ startsAt: '2030-02-02T09:00:00.000Z', endsAt: '2030-02-02T10:00:00.000Z' }] }],
      ['appt_2/schedule', { selectedWindowIndex: 0 }],
      ['appt_2/decline', {}],
      ['appt_3/cancel', undefined],
    ]);
  });

  it('times an uncached authenticated read of the appointment for the network probe', async () => {
    const { api, sent } = callsApiWith(() => json(200, APPOINTMENT));
    const ms = await api.networkProbe('appt_1')();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(sent[0]).toMatchObject({ url: 'http://x/api/appointments/appt_1', method: 'GET', cache: 'no-store' });
  });
});

describe('retryUnlessClientError', () => {
  it('never retries a 4xx and retries a network failure or 5xx once', () => {
    const error = (status: number) => new ApiError({ status, code: String(status), message: '', requestId: null });
    expect(retryUnlessClientError(0, error(404))).toBe(false);
    expect(retryUnlessClientError(0, error(503))).toBe(true);
    expect(retryUnlessClientError(1, error(503))).toBe(false);
    expect(retryUnlessClientError(0, error(0))).toBe(true);
  });
});
