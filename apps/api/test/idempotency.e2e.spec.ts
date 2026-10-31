/**
 * @Idempotent e2e: a test-only controller (never part of AppModule) driven
 * through the real interceptor and exception filter. A stand-in guard sets the
 * principal from `x-test-user`; the real guards are covered by their own suites.
 *
 * @see T-C1.07
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Body,
  Controller,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Authenticated } from '../src/authz/authenticated.decorator.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';
import { Idempotent } from '../src/common/idempotency/index.js';
import { KEY_VALUE_STORE } from '../src/redis/key-value-store.js';
import { MemoryKeyValueStore } from '../src/redis/memory-key-value-store.js';

let runs = 0;

@Injectable()
class TestPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.principal = { userId: req.headers['x-test-user'] ?? 'u1' };
    return true;
  }
}

@Controller('idem-test')
class IdemTestController {
  @Post()
  @Authenticated()
  @Idempotent('test')
  create(@Body() body: { name: string }) {
    runs += 1;
    return { id: `item-${runs}`, name: body.name };
  }

  @Post('fail')
  @Authenticated()
  @Idempotent('test')
  fail() {
    runs += 1;
    if (runs % 2 === 1) throw new Error('transient');
    return { ok: true };
  }
}

@Module({
  controllers: [IdemTestController],
  providers: [
    { provide: KEY_VALUE_STORE, useValue: new MemoryKeyValueStore() },
    { provide: APP_GUARD, useClass: TestPrincipalGuard },
  ],
})
class IdemTestModule {}

describe('@Idempotent (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [IdemTestModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (key: string | null, body: unknown, user = 'u1', path = '/api/idem-test') => {
    const r = request(app.getHttpServer()).post(path).set('x-test-user', user);
    if (key !== null) r.set('Idempotency-Key', key);
    return r.send(body as object);
  };

  it('replays the stored response and runs the handler once', async () => {
    runs = 0;
    const first = await post('k-replay', { name: 'a' });
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const second = await post('k-replay', { name: 'a' });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(runs).toBe(1);
  });

  it('409 idempotency_conflict envelope for a different body', async () => {
    await post('k-mismatch', { name: 'a' });
    const res = await post('k-mismatch', { name: 'b' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      status: 409,
      code: 'idempotency_conflict',
      details: { reason: 'payload_mismatch' },
    });
  });

  it('400 validation for an invalid key', async () => {
    const res = await post('bad key', { name: 'a' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation');
  });

  it('runs every time without the header', async () => {
    runs = 0;
    await post(null, { name: 'a' });
    await post(null, { name: 'a' });
    expect(runs).toBe(2);
  });

  it('another user may reuse the same key', async () => {
    runs = 0;
    const a = await post('k-user', { name: 'a' }, 'u1');
    const b = await post('k-user', { name: 'b' }, 'u2');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(runs).toBe(2);
  });

  it('a failed handler does not poison the key', async () => {
    runs = 0; // first call (runs=1) throws, the retry (runs=2) succeeds
    const failed = await post('k-fail', {}, 'u1', '/api/idem-test/fail');
    expect(failed.status).toBe(500);
    const retry = await post('k-fail', {}, 'u1', '/api/idem-test/fail');
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual({ ok: true });
  });
});
