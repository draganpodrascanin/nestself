import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './client';
import { ApiError } from './errors';

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
