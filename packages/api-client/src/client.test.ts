import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './client.js';
import { ApiError } from './errors.js';

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
    let capturedHeaders: Headers | undefined;

    const capturingFetch: typeof fetch = async (input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = createApiClient({
      baseUrl: 'http://localhost',
      getToken: () => 'my-token',
      fetchImpl: capturingFetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer my-token');
  });

  it('does not send Authorization header when getToken returns null', async () => {
    let capturedHeaders: Headers | undefined;

    const capturingFetch: typeof fetch = async (input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = createApiClient({
      baseUrl: 'http://localhost',
      getToken: () => null,
      fetchImpl: capturingFetch,
    });

    await client.request('/api/test', { schema: TestSchema });
    expect(capturedHeaders?.get('Authorization')).toBeNull();
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
