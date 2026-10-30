/**
 * Webinar recording with the fake provider, end to end in one API process
 * (T-CW-2.5, DEF-5): with `VIDEO_PROVIDER=none` the meetings live in the API
 * process's memory, so the API consumes the webinar jobs itself
 * (`WebinarsModule.onApplicationBootstrap`). A host starts the webinar and
 * joins; the `webinar.recording.start` job the start route enqueued waits for
 * the meeting, starts the capture and the recording reaches `recording`; the
 * moderator's stop moves it to `processing`, and the finalize job, again in
 * this process, makes it `ready`. Nothing calls a job handler by hand here.
 *
 * Principals: `user_milica` (expert, the presenter) and `user_nikola`
 * (operations, the moderator), as in `webinars.e2e.spec.ts`.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL) and Redis (`TEST_REDIS_URL`,
 * default `redis://localhost:6379`, under a run-specific BullMQ prefix).
 * Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { Redis } from 'ioredis';
import { WebinarRecordingStatusResponseSchema, type RecordingStatus } from '@nestself/contracts';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { WebinarJobSchedulerService } from '../src/jobs/webinar-job-scheduler.service.js';
import { WebinarRecordingService } from '../src/webinars/recording.service.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
const ORG = 'org_sample';
const MINUTE = 60_000;
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const STAFF = ['user_milica', 'user_nikola'];

async function redisAnswers(url: string): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1_000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

const redisUp = TEST_DB_URL ? await redisAnswers(REDIS_URL) : false;

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!TEST_DB_URL || !redisUp)('Webinar recording with the fake provider in the API process (e2e, DEF-5)', () => {
  let app: INestApplication;
  let testDb: TestDatabase;
  let scheduler: WebinarJobSchedulerService;
  let nikola: SignedIn;
  let milica: SignedIn;
  const queuePrefix = `nestself-test-cw25-${randomBytes(4).toString('hex')}`;

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('nestself_csrf='))?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  async function signInStaff(userId: string, context: Record<string, string>): Promise<SignedIn> {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent.post('/api/auth/password').send({ email: `${userId}@example.com`, password: SAMPLE_DEV_PASSWORD });
    expect(pw.status).toBe(200);
    const totp = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);
    const who = { agent, csrf: extractCsrf(totp) };
    expect((await agent.post('/api/auth/context').set('X-CSRF-Token', who.csrf).send({ context })).status).toBe(200);
    return who;
  }

  const post = (who: SignedIn, path: string, body: unknown = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body as object);

  /** Polls `GET /webinars/:id/recording` until `status`, for up to 10 seconds. */
  async function recordingReaches(who: SignedIn, webinarId: string, status: RecordingStatus): Promise<RecordingStatus> {
    const deadline = Date.now() + 10_000;
    let current: RecordingStatus = 'scheduled';
    while (Date.now() < deadline) {
      const res = await who.agent.get(`/api/webinars/${webinarId}/recording`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      current = WebinarRecordingStatusResponseSchema.parse(res.body).status;
      if (current === status) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return current;
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'webinar_recording');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.VIDEO_PROVIDER = 'none';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;
    delete process.env.VIDEO_FAKE_EVENTS_IN_API;

    // The queue on the shared Redis under this run's prefix; the provider as the API process sees it.
    const schedulerConfig = {
      get: (key: string) => ({ REDIS_URL, VIDEO_PROVIDER: 'none' })[key as 'REDIS_URL' | 'VIDEO_PROVIDER'],
    };
    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebinarJobSchedulerService)
      .useFactory({
        factory: () => {
          scheduler = new WebinarJobSchedulerService(schedulerConfig as unknown as ConfigService);
          scheduler.prefix = queuePrefix;
          return scheduler;
        },
      })
      .compile();
    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    // The start job checks for the host's meeting every 200 ms instead of every 15 seconds.
    app.get(WebinarRecordingService).startRetryDelayMs = 200;
    await app.init();

    const idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    idp.seedUsers(
      SAMPLE_EXTERNAL_IDENTITIES.filter((i) => STAFF.includes(i.userId)).map((i) => ({
        email: i.email,
        sub: i.subject,
        username: i.cognitoUsername,
        password: SAMPLE_DEV_PASSWORD,
        totpSecret: TOTP_SECRET,
        totpEnrolled: true,
      })),
    );
    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    milica = await signInStaff('user_milica', { kind: 'expert' });
  }, 180_000);

  afterAll(async () => {
    await scheduler?.getQueue()?.obliterate({ force: true }).catch(() => undefined);
    await app?.close();
    await testDb?.close();
  });

  it('the API process consumes the webinar queue with the fake provider', () => {
    expect(scheduler.consumesInApi()).toBe(true);
    expect(scheduler.isConsuming()).toBe(true);
  });

  it('a started webinar records once the presenter is in the meeting; the stop moves it to processing, then ready', async () => {
    const startsAt = new Date(Date.now() + 5 * MINUTE);
    const created = await post(nikola, '/ops/webinars', {
      title: { en: 'Recorded with the fake provider' },
      presenterUserIds: ['user_milica'],
      moderatorUserId: 'user_nikola',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 60 * MINUTE).toISOString(),
      timeZone: 'Europe/Belgrade',
      audiencePolicy: { type: 'organization', orgIds: [ORG] },
      capacity: 2,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    expect((await post(nikola, `/ops/webinars/${id}/publish`)).status).toBe(200);

    // The start enqueues webinar.recording.start; the job waits for the host's meeting.
    expect((await post(milica, `/webinars/${id}/start`)).status).toBe(200);
    expect((await post(milica, `/webinars/${id}/join`)).status).toBe(200);
    expect(await recordingReaches(nikola, id, 'recording')).toBe('recording');

    const stopped = await post(nikola, `/webinars/${id}/recording/stop`);
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);
    expect(WebinarRecordingStatusResponseSchema.parse(stopped.body)).toMatchObject({
      webinarId: id,
      status: 'processing',
      startedAt: expect.any(String),
      stoppedAt: expect.any(String),
    });
    // The finalize job runs in this process too: the fake concatenation completes at once.
    expect(await recordingReaches(nikola, id, 'ready')).toBe('ready');
  });
});
