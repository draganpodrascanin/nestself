import { describe, it, expect } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';

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
});
