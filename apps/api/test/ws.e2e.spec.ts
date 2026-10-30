/**
 * WebSocket authentication and authorization e2e tests.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 *
 * @see T-1.11, T-CW-1.6, T-CW-2.3, AUTHZ-R-58, AUTHZ-R-59, AUTHZ-R-60
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { externalIdentities } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';
import { NestSelfIoAdapter } from '../src/ws/nestself-io.adapter.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { computeTotp } from '../src/identity/totp.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';
import { RoomEmitter } from '../src/ws/room-emitter.js';
import { TestSocket, expectConnectRejected } from './ws-test-client.js';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

/** Fixed TOTP secret for the seed expert of this suite (base32). */
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
/** The seeded consultation: user_milica is its expert and user_jovan its employee. */
const CALL_ROOM = 'call:call_session_sample_consultation';
/** The seeded ended webinar: user_milica presents, user_nikola moderates, user_jovan is registered (T-CW-2.3). */
const WEBINAR_ROOM = 'webinar:webinar_sample_ended';
const WEBINAR_MODERATION_ROOM = 'webinar:webinar_sample_ended:moderation';
const WEBINAR_HOSTS_ROOM = 'webinar:webinar_sample_ended:hosts';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!shouldRun)('WebSocket auth (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let baseUrl: string;
  let principalLoader: PrincipalLoader;

  const jwtSecret = randomBytes(32).toString('hex');

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'ws');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.WORKSPACE_URL = 'http://localhost:5173';
    process.env.ADMIN_URL = 'http://localhost:5174';
    delete process.env.REDIS_URL;

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const { ApiExceptionFilter } = await import(
      '../src/common/api-exception.filter.js'
    );

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useWebSocketAdapter(new NestSelfIoAdapter(app));
    await app.init();
    await app.listen(0);

    const httpServer = app.getHttpServer();
    const addr = httpServer.address();
    const port =
      typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    principalLoader = app.get(PrincipalLoader);

    // Seed FakeIdentityProvider
    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    idp.seedUsers([
      { email: 'user_jovan@example.com' },
      { email: 'user_ivana@example.com' },
    ]);

    const people = [
      { localId: 'user_jovan', email: 'user_jovan@example.com' },
      { localId: 'user_ivana', email: 'user_ivana@example.com' },
    ];
    // The seed expert signs in with password and TOTP under the seeded identity.
    const milica = SAMPLE_EXTERNAL_IDENTITIES.find((i) => i.userId === 'user_milica')!;
    idp.seedUsers([
      {
        email: milica.email,
        sub: milica.subject,
        username: milica.cognitoUsername,
        password: SAMPLE_DEV_PASSWORD,
        totpSecret: TOTP_SECRET,
        totpEnrolled: true,
      },
    ]);

    for (const p of people) {
      const idpUser = await idp.findUserByEmail(p.email);
      if (!idpUser) throw new Error(`FakeIDP user not found: ${p.email}`);
      await testDb.db.insert(externalIdentities).values({
        userId: p.localId,
        provider: 'cognito',
        subject: idpUser.sub,
        cognitoUsername: idpUser.username,
        email: p.email,
        emailVerified: true,
      });
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  async function signIn(email: string): Promise<{ cookie: string; csrf: string; agent: ReturnType<typeof request.agent> }> {
    const agent = request.agent(app.getHttpServer());
    const startRes = await agent
      .post('/api/auth/email-otp/start')
      .send({ email });
    expect(startRes.status).toBe(200);

    const lastCode = idp.sentCodes
      .filter((c) => c.email === email)
      .pop();
    expect(lastCode).toBeDefined();

    const verifyRes = await agent
      .post('/api/auth/email-otp/verify')
      .send({
        challengeToken: startRes.body.challengeToken,
        code: lastCode!.code,
      });
    expect(verifyRes.status).toBe(200);

    const setCookies = verifyRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = setCookies.find((c: string) =>
      c.startsWith('nestself_session='),
    );
    expect(sessionCookie).toBeDefined();
    const csrfCookie = setCookies.find((c: string) =>
      c.startsWith('nestself_csrf='),
    );
    const csrfMatch = csrfCookie?.match(/nestself_csrf=([^;]+)/);
    expect(csrfMatch).toBeTruthy();

    // Extract just the cookie name=value pairs
    const cookiePairs = setCookies
      .map((c: string) => c.split(';')[0]!)
      .join('; ');

    return {
      cookie: cookiePairs,
      csrf: csrfMatch![1]!,
      agent,
    };
  }

  /** Password and TOTP sign-in of the seed expert, in the expert context. */
  async function signInExpert(email: string): Promise<{ cookie: string }> {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent.post('/api/auth/password').send({ email, password: SAMPLE_DEV_PASSWORD });
    expect(pw.status).toBe(200);
    const totp = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);

    const cookies = new Map<string, string>();
    const remember = (res: request.Response) => {
      for (const c of (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []) {
        const pair = c.split(';')[0]!;
        cookies.set(pair.slice(0, pair.indexOf('=')), pair);
      }
    };
    remember(totp);
    const csrf = cookies.get('nestself_csrf')!.slice('nestself_csrf='.length);
    const context = await agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', csrf)
      .send({ context: { kind: 'expert' } });
    expect(context.status).toBe(200);
    remember(context);
    return { cookie: [...cookies.values()].join('; ') };
  }

  // -----------------------------------------------------------------------
  // 1. Web cookie auth: connect succeeds
  // -----------------------------------------------------------------------

  it('web: connects with session cookie', async () => {
    const { cookie } = await signIn('user_jovan@example.com');

    const socket = new TestSocket({
      baseUrl,
      cookie,
      origin: 'http://localhost:5173',
    });

    await socket.connect(5000);
    expect(socket.isConnected).toBe(true);
    await socket.disconnect();
  });

  // -----------------------------------------------------------------------
  // 2. Subscribe: employee is denied access to programme
  // -----------------------------------------------------------------------

  it('subscribe: employee denied for program.overview', async () => {
    const { cookie } = await signIn('user_jovan@example.com');

    const socket = new TestSocket({
      baseUrl,
      cookie,
      origin: 'http://localhost:5173',
    });
    await socket.connect(5000);

    await socket.emitEvent('subscribe', {
      room: 'org:org_sample:programme',
      action: 'program.overview',
      resource: { type: 'program', orgId: 'org_sample' },
    });

    const data = await socket.waitForEvent('subscribe:denied', 5000);
    expect(data).toHaveProperty('room', 'org:org_sample:programme');
    await socket.disconnect();
  });

  // -----------------------------------------------------------------------
  // 3. Subscribe: hr_admin is allowed for programme
  // -----------------------------------------------------------------------

  it('subscribe: hr_admin allowed for program.overview', async () => {
    const { cookie } = await signIn('user_ivana@example.com');

    const socket = new TestSocket({
      baseUrl,
      cookie,
      origin: 'http://localhost:5173',
    });
    await socket.connect(5000);

    await socket.emitEvent('subscribe', {
      room: 'org:org_sample:programme',
      action: 'program.overview',
      resource: { type: 'program', orgId: 'org_sample' },
    });

    const data = await socket.waitForEvent('subscribe:ok', 5000);
    expect(data).toHaveProperty('room', 'org:org_sample:programme');
    await socket.disconnect();
  });

  // -----------------------------------------------------------------------
  // 3b. Call room (T-CW-1.6): the session's employee joins `call:{sessionId}`;
  //     hr_admin, a signed-in non-participant, is refused as for an unknown
  //     room, whatever action and resource the client names.
  // -----------------------------------------------------------------------

  it('subscribe: call room is open to the session participants only', async () => {
    const room = CALL_ROOM;

    const { cookie: employeeCookie } = await signIn('user_jovan@example.com');
    const employee = new TestSocket({ baseUrl, cookie: employeeCookie, origin: 'http://localhost:5173' });
    await employee.connect(5000);
    await employee.emitEvent('subscribe', { room });
    expect(await employee.waitForEvent('subscribe:ok', 5000)).toEqual({ room });
    await employee.disconnect();

    const { cookie: expertCookie } = await signInExpert('user_milica@example.com');
    const theExpert = new TestSocket({ baseUrl, cookie: expertCookie, origin: 'http://localhost:5174' });
    await theExpert.connect(5000);
    await theExpert.emitEvent('subscribe', { room });
    expect(await theExpert.waitForEvent('subscribe:ok', 5000)).toEqual({ room });
    await theExpert.disconnect();

    const { cookie: hrCookie } = await signIn('user_ivana@example.com');
    const hr = new TestSocket({ baseUrl, cookie: hrCookie, origin: 'http://localhost:5173' });
    await hr.connect(5000);
    await hr.emitEvent('subscribe', {
      room,
      action: 'consultation.join',
      resource: { type: 'call_session', id: 'call_session_sample_consultation' },
    });
    expect(await hr.waitForEvent('subscribe:denied', 5000)).toEqual({ room, reason: 'not_found' });
    await hr.emitEvent('subscribe', { room: 'call:no_such_session' });
    expect(await hr.waitForEvent('subscribe:denied', 5000)).toEqual({
      room: 'call:no_such_session',
      reason: 'not_found',
    });
    await hr.disconnect();
  });

  // -----------------------------------------------------------------------
  // 3b'. Webinar rooms (T-CW-2.3): registrants and hosts in the public room,
  //      presenters in the hosts room (counts, WBN-19) but never in the
  //      moderation room, which carries names (CW-R-36a); anyone else and an
  //      unknown occurrence get the same not_found.
  // -----------------------------------------------------------------------

  it('subscribe: webinar rooms are open to registrants and hosts; presenters get the hosts room, not the moderation room', async () => {
    const { cookie: employeeCookie } = await signIn('user_jovan@example.com');
    const registrant = new TestSocket({ baseUrl, cookie: employeeCookie, origin: 'http://localhost:5173' });
    await registrant.connect(5000);
    await registrant.emitEvent('subscribe', { room: WEBINAR_ROOM });
    expect(await registrant.waitForEvent('subscribe:ok', 5000)).toEqual({ room: WEBINAR_ROOM });
    for (const room of [WEBINAR_MODERATION_ROOM, WEBINAR_HOSTS_ROOM]) {
      await registrant.emitEvent('subscribe', { room });
      expect(await registrant.waitForEvent('subscribe:denied', 5000)).toEqual({ room, reason: 'not_found' });
    }

    const worker = new RoomEmitter(app.get<KeyValueStore>(KEY_VALUE_STORE));
    expect(worker.emit(WEBINAR_ROOM, 'webinar.floor.state', { active: true })).toBe(true);
    expect(await registrant.waitForEvent('webinar.floor.state', 5000)).toEqual({ active: true });
    await registrant.disconnect();

    const { cookie: expertCookie } = await signInExpert('user_milica@example.com');
    const presenter = new TestSocket({ baseUrl, cookie: expertCookie, origin: 'http://localhost:5174' });
    await presenter.connect(5000);
    for (const room of [WEBINAR_ROOM, WEBINAR_HOSTS_ROOM]) {
      await presenter.emitEvent('subscribe', { room });
      expect(await presenter.waitForEvent('subscribe:ok', 5000)).toEqual({ room });
    }
    await presenter.emitEvent('subscribe', { room: WEBINAR_MODERATION_ROOM });
    expect(await presenter.waitForEvent('subscribe:denied', 5000)).toEqual({ room: WEBINAR_MODERATION_ROOM, reason: 'not_found' });
    expect(worker.emit(WEBINAR_HOSTS_ROOM, 'webinar.attendance.count', { webinarId: 'webinar_sample_ended', count: 2 })).toBe(true);
    expect(await presenter.waitForEvent('webinar.attendance.count', 5000)).toEqual({ webinarId: 'webinar_sample_ended', count: 2 });
    expect(worker.emit(WEBINAR_HOSTS_ROOM, 'webinar.floor.state', { active: true, participantId: 'call_participant_sample_attendee_jovan' })).toBe(true);
    expect(await presenter.waitForEvent('webinar.floor.state', 5000)).toEqual({ active: true, participantId: 'call_participant_sample_attendee_jovan' });
    await presenter.disconnect();

    const { cookie: hrCookie } = await signIn('user_ivana@example.com');
    const outsider = new TestSocket({ baseUrl, cookie: hrCookie, origin: 'http://localhost:5173' });
    await outsider.connect(5000);
    for (const room of [WEBINAR_ROOM, WEBINAR_MODERATION_ROOM, WEBINAR_HOSTS_ROOM, 'webinar:no_such_webinar', 'webinar:no_such_webinar:hosts']) {
      await outsider.emitEvent('subscribe', { room });
      expect(await outsider.waitForEvent('subscribe:denied', 5000)).toEqual({ room, reason: 'not_found' });
    }
    await outsider.disconnect();
  });

  // -----------------------------------------------------------------------
  // 3c. Room events relay (T-CW-1.6): a second RoomEmitter on the store,
  //     with no gateway, as in the worker, reaches a subscribed socket once.
  //     The in-memory store stands in for Redis pub/sub.
  // -----------------------------------------------------------------------

  it('room events: an emit from another process reaches a subscribed socket once', async () => {
    const { cookie } = await signIn('user_jovan@example.com');
    const socket = new TestSocket({ baseUrl, cookie, origin: 'http://localhost:5173' });
    await socket.connect(5000);
    await socket.emitEvent('subscribe', { room: CALL_ROOM });
    await socket.waitForEvent('subscribe:ok', 5000);

    const worker = new RoomEmitter(app.get<KeyValueStore>(KEY_VALUE_STORE));
    expect(worker).not.toBe(app.get(RoomEmitter));
    const proposal = {
      appointmentId: 'appt_sample_completed',
      followUpId: 'appt_sample_follow_up_proposed',
      startsAt: '2026-11-04T15:00:00.000Z',
      durationMinutes: 50,
    };
    expect(worker.emit(CALL_ROOM, 'appointment.follow_up.proposed', proposal)).toBe(true);

    expect(await socket.waitForEvent('appointment.follow_up.proposed', 5000)).toEqual(proposal);
    await expect(socket.waitForEvent('appointment.follow_up.proposed', 500)).rejects.toThrow(/Timeout/);
    await socket.disconnect();
  });

  // -----------------------------------------------------------------------
  // 4. Mobile: ticket auth works
  // -----------------------------------------------------------------------

  it('mobile: connects with ws-ticket', async () => {
    const { agent, csrf } = await signIn('user_jovan@example.com');

    // Get a ws-ticket
    const ticketRes = await agent
      .post('/api/auth/ws-ticket')
      .set('X-CSRF-Token', csrf);
    expect(ticketRes.status).toBe(200);
    expect(ticketRes.body).toHaveProperty('ticket');

    const socket = new TestSocket({
      baseUrl,
      ticket: ticketRes.body.ticket,
    });
    await socket.connect(5000);
    expect(socket.isConnected).toBe(true);
    await socket.disconnect();
  });

  // -----------------------------------------------------------------------
  // 5. Mobile: reused ticket fails (AUTHZ-R-60)
  // -----------------------------------------------------------------------

  it('mobile: reused ticket fails', async () => {
    const { agent, csrf } = await signIn('user_jovan@example.com');

    const ticketRes = await agent
      .post('/api/auth/ws-ticket')
      .set('X-CSRF-Token', csrf);
    expect(ticketRes.status).toBe(200);
    const ticket = ticketRes.body.ticket;

    // First use succeeds
    const socket1 = new TestSocket({ baseUrl, ticket });
    await socket1.connect(5000);
    expect(socket1.isConnected).toBe(true);
    await socket1.disconnect();

    // Second use fails
    const error = await expectConnectRejected({ baseUrl, ticket });
    expect(error).toMatch(/invalid_ticket|error|failed/i);
  });

  // -----------------------------------------------------------------------
  // 6. Wrong origin is rejected
  // -----------------------------------------------------------------------

  it('wrong origin is rejected', async () => {
    const { cookie } = await signIn('user_jovan@example.com');

    const error = await expectConnectRejected({
      baseUrl,
      cookie,
      origin: 'http://evil.example.com',
    });
    expect(error).toMatch(/forbidden_origin|error|failed/i);
  });

  // -----------------------------------------------------------------------
  // 7. Suspension disconnects the socket via invalidation
  // -----------------------------------------------------------------------

  it('suspended user is disconnected via invalidation', async () => {
    const { cookie } = await signIn('user_jovan@example.com');

    const socket = new TestSocket({
      baseUrl,
      cookie,
      origin: 'http://localhost:5173',
    });
    await socket.connect(5000);
    expect(socket.isConnected).toBe(true);

    // Suspend the user directly in the database
    await testDb.pool.query(
      "UPDATE users SET suspended_at = now() WHERE id = 'user_jovan'",
    );

    // Invalidate the principal cache and publish to the invalidation channel.
    // In production, the code that suspends a user calls invalidateUser().
    await principalLoader.invalidateUser('user_jovan');

    // Wait for the socket to be disconnected (up to 5 seconds)
    const wasDisconnected = await socket.waitForDisconnect(5000);
    expect(wasDisconnected).toBe(true);

    // Restore the user for subsequent tests
    await testDb.pool.query(
      "UPDATE users SET suspended_at = null WHERE id = 'user_jovan'",
    );
  });
});
