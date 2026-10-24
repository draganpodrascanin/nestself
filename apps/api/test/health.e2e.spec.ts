import { describe, it, expect } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';
import { KEY_VALUE_STORE } from '../src/redis/key-value-store.js';
import { MemoryKeyValueStore } from '../src/redis/memory-key-value-store.js';

describe('Health (e2e)', () => {
  const dbStub = {
    ping: async () => {},
    onModuleInit: async () => {},
    onModuleDestroy: async () => {},
  };

  it('GET /api/health returns 200 with status ok', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DbService)
      .useValue(dbStub)
      .compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body.info.database).toMatchObject({ status: 'up' });
    // Tests run without REDIS_URL, so the key-value store is the in-memory one.
    expect(res.body.info.redis).toMatchObject({ status: 'up', mode: 'memory' });
    expect(res.body.details.redis).toMatchObject({ status: 'up', mode: 'memory' });

    await app.close();
  });

  it('GET /api/health returns 503 when database is down', async () => {
    const failingStub = {
      ...dbStub,
      ping: async () => {
        throw new Error('Connection refused');
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DbService)
      .useValue(failingStub)
      .compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('status', 'error');

    await app.close();
  });

  it('GET /api/health returns 503 when Redis does not answer PING', async () => {
    class DeadStore extends MemoryKeyValueStore {
      override async ping(): Promise<boolean> {
        return false;
      }
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DbService)
      .useValue(dbStub)
      .overrideProvider(KEY_VALUE_STORE)
      .useValue(new DeadStore())
      .compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('status', 'error');
    expect(res.body.info.database).toMatchObject({ status: 'up' });
    expect(res.body.error.redis).toMatchObject({ status: 'down' });

    await app.close();
  });
});
