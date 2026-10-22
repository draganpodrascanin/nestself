/**
 * WebSocket authentication and authorization e2e tests.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 *
 * @see T-1.11, AUTHZ-R-58, AUTHZ-R-59, AUTHZ-R-60
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { externalIdentities } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';
import { NestSelfIoAdapter } from '../src/ws/nestself-io.adapter.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { TestSocket, expectConnectRejected } from './ws-test-client.js';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

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
