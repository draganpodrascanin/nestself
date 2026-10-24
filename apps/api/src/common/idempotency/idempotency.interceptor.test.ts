import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Controller, Post, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { MemoryKeyValueStore } from '../../redis/memory-key-value-store.js';
import { idempotencyKey } from '../../redis/redis-keys.js';
import { Idempotent } from './idempotent.decorator.js';
import {
  IdempotencyInterceptor,
  canonicalJson,
  requestFingerprint,
} from './idempotency.interceptor.js';
import { ApiHttpException } from '../api-error.js';

@Controller('t')
class TestController {
  @Post()
  @Idempotent('test')
  optional() {}

  @Post('req')
  @Idempotent('test', { required: true })
  required() {}
}

function ctx(
  handler: () => void,
  req: { headers?: Record<string, unknown>; body?: unknown; userId?: string | null; method?: string; path?: string },
  headers: Record<string, string>,
): ExecutionContext {
  const request = {
    method: req.method ?? 'POST',
    path: req.path ?? '/api/t',
    body: req.body,
    headers: req.headers ?? {},
    principal: req.userId === null ? undefined : { userId: req.userId ?? 'u1' },
  };
  const response = { setHeader: (k: string, v: string) => (headers[k] = v) };
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

const proto = TestController.prototype;
const KEY = 'abc-123';

describe('IdempotencyInterceptor', () => {
  let store: MemoryKeyValueStore;
  let interceptor: IdempotencyInterceptor;
  let responseHeaders: Record<string, string>;

  beforeEach(() => {
    store = new MemoryKeyValueStore();
    interceptor = new IdempotencyInterceptor(new Reflector(), store);
    responseHeaders = {};
  });

  async function call(
    handler: () => void,
    req: Parameters<typeof ctx>[1],
    result: () => unknown = () => ({ ok: true }),
  ) {
    const run = vi.fn(() => of(result()));
    const obs = await interceptor.intercept(ctx(handler, req, responseHeaders), { handle: run });
    return { run, value: await firstValueFrom(obs) };
  }

  const withKey = (body: unknown, key = KEY, userId = 'u1') => ({
    headers: { 'idempotency-key': key },
    body,
    userId,
  });

  it('first call runs the handler and stores the response for 24 h', async () => {
    const { run, value } = await call(proto.optional, withKey({ a: 1 }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(value).toEqual({ ok: true });
    const k = idempotencyKey('test', 'u1', KEY);
    const stored = JSON.parse((await store.get(k))!);
    expect(stored).toMatchObject({ state: 'complete', status: 201, body: { ok: true } });
    expect(stored.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.ttl(k)).toBeGreaterThan(86000);
  });

  it('does not store the request body', async () => {
    await call(proto.optional, withKey({ secret: 'hunter2' }));
    const raw = (await store.get(idempotencyKey('test', 'u1', KEY)))!;
    expect(raw).not.toContain('hunter2');
  });

  it('replays the stored result without running the handler again', async () => {
    let n = 0;
    await call(proto.optional, withKey({ a: 1 }), () => ({ n: ++n }));
    const second = await call(proto.optional, withKey({ a: 1 }), () => ({ n: ++n }));
    expect(second.value).toEqual({ n: 1 });
    expect(responseHeaders['Idempotent-Replayed']).toBe('true');
  });

  it('treats key order in the body as the same payload', async () => {
    await call(proto.optional, withKey({ a: 1, b: { c: 2, d: 3 } }));
    const again = await call(proto.optional, withKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(again.value).toEqual({ ok: true });
  });

  it('409 idempotency_conflict payload_mismatch for a different body', async () => {
    await call(proto.optional, withKey({ a: 1 }));
    await expect(call(proto.optional, withKey({ a: 2 }))).rejects.toMatchObject({
      code: 'idempotency_conflict',
      details: { reason: 'payload_mismatch' },
    });
    await expect(call(proto.optional, withKey({ a: 2 }))).rejects.toMatchObject({
      constructor: ApiHttpException,
    });
  });

  it('payload_mismatch also for a different path', async () => {
    await call(proto.optional, withKey({ a: 1 }));
    await expect(
      call(proto.optional, { ...withKey({ a: 1 }), path: '/api/other' }),
    ).rejects.toMatchObject({ details: { reason: 'payload_mismatch' } });
  });

  it('409 in_progress for a concurrent duplicate', async () => {
    const holder = interceptor.intercept(ctx(proto.optional, withKey({ a: 1 }), {}), {
      handle: () => of({ slow: true }),
    });
    const obs = await holder; // reserved, not yet subscribed
    await expect(call(proto.optional, withKey({ a: 1 }))).rejects.toMatchObject({
      status: 409,
      code: 'idempotency_conflict',
      details: { reason: 'in_progress' },
    });
    await firstValueFrom(obs); // completes and stores
    const replay = await call(proto.optional, withKey({ a: 1 }));
    expect(replay.value).toEqual({ slow: true });
  });

  it('releases the reservation when the handler throws', async () => {
    const boom = new Error('boom');
    const obs = await interceptor.intercept(ctx(proto.optional, withKey({ a: 1 }), {}), {
      handle: () => throwError(() => boom),
    });
    await expect(firstValueFrom(obs)).rejects.toBe(boom);
    expect(await store.get(idempotencyKey('test', 'u1', KEY))).toBeNull();
    const retry = await call(proto.optional, withKey({ a: 1 }));
    expect(retry.run).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'has space', 'tab\t', 'café', 'x'.repeat(256)])(
    '400 validation for invalid key %j',
    async (bad) => {
      await expect(call(proto.optional, withKey({}, bad))).rejects.toMatchObject({
        status: 400,
        code: 'validation',
      });
    },
  );

  it('accepts a 255 character key', async () => {
    const { run } = await call(proto.optional, withKey({}, 'k'.repeat(255)));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs normally without the header', async () => {
    const { run, value } = await call(proto.optional, { body: {} });
    expect(run).toHaveBeenCalledTimes(1);
    expect(value).toEqual({ ok: true });
    expect(await store.scan('idempotency:*')).toEqual([]);
  });

  it('400 validation without the header when required', async () => {
    await expect(call(proto.required, { body: {} })).rejects.toMatchObject({
      status: 400,
      code: 'validation',
    });
  });

  it('keys are per user', async () => {
    await call(proto.optional, withKey({ a: 1 }, KEY, 'u1'));
    const other = await call(proto.optional, withKey({ a: 2 }, KEY, 'u2'));
    expect(other.run).toHaveBeenCalledTimes(1);
    expect(await store.scan('idempotency:test:*')).toHaveLength(2);
  });

  it('keys are per scope', async () => {
    await store.set(idempotencyKey('other', 'u1', KEY), 'x');
    const { run } = await call(proto.optional, withKey({ a: 1 }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('401 when no principal is present', async () => {
    await expect(call(proto.optional, { ...withKey({}), userId: null })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('fingerprint helpers', () => {
  it('canonicalJson sorts keys recursively', () => {
    expect(canonicalJson({ b: [{ z: 1, y: 2 }], a: 1 })).toBe('{"a":1,"b":[{"y":2,"z":1}]}');
  });
  it('fingerprint depends on method, path and body', () => {
    const a = requestFingerprint('POST', '/x', { a: 1 });
    expect(requestFingerprint('post', '/x', { a: 1 })).toBe(a);
    expect(requestFingerprint('PUT', '/x', { a: 1 })).not.toBe(a);
    expect(requestFingerprint('POST', '/y', { a: 1 })).not.toBe(a);
    expect(requestFingerprint('POST', '/x', { a: 2 })).not.toBe(a);
  });
});
