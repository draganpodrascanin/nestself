/**
 * Media replication e2e (T-CW-3.2, D-CW-14, D-CW-35, WEB-07 to WEB-09):
 * a webinar above one meeting over HTTP against the `FakeVideoProvider`.
 *
 * - The occurrence form takes up to 1,000 and refuses 1,001 with
 *   `capacity_above_limit` and the limit, without a milestone note.
 * - Capacity 500: the first host's join creates one primary and two
 *   replicas (`PrimaryMeetingId`), kept on the session; hosts land on the
 *   primary; three attendees are spread over the replicas (least loaded,
 *   ties by index) and the replica is kept on the participant.
 * - The floor for a replica attendee is an audio-only attendee on the
 *   primary (`promoteToPrimary`); its credentials go to that attendee's own
 *   socket as `primaryAttendee`, never in the host's response; taking the
 *   floor back deletes it (`demoteFromPrimary`).
 * - The end deletes the replicas, then the primary.
 *
 * Principals: `user_milica` the presenter (expert), `user_nikola` the
 * moderator (operations), `user_jovan`, `user_ana` and `user_ivana`
 * attendees. The webinar queue runs without Redis.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { asc, eq } from 'drizzle-orm';
import {
  WEBINAR_REPLICATED_CAPACITY,
  WebinarJoinResponseSchema,
  type WebinarJoinResponse,
} from '@nestself/contracts';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { AuditWriter } from '../src/audit/audit-writer.js';
import { VIDEO_PROVIDER } from '../src/video/video-provider.js';
import type { FakeVideoProvider } from '../src/video/fake-video-provider.js';
import { RoomEmitter } from '../src/ws/room-emitter.js';
import { WebinarJobSchedulerService } from '../src/jobs/webinar-job-scheduler.service.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { callParticipants, callSessions } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const MINUTE = 60_000;
/** Fixed TOTP secret for the staff and expert users of this suite (base32). */
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const STAFF = ['user_milica', 'user_nikola'];
const PEOPLE = ['user_milica', 'user_nikola', 'user_jovan', 'user_ana', 'user_ivana'];
const FLOOR = { audio: 'send_receive', video: 'receive', content: 'receive' };
const RECEIVE_ONLY = { audio: 'receive', video: 'receive', content: 'receive' };

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

/** The fake's private attendee lookup, to read capabilities as Chime would hold them. */
type AttendeeLookup = { findAttendee(meetingId: string, attendeeId: string): { Capabilities: unknown } | undefined };

describe.skipIf(!shouldRun)('Webinar media replication (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let video: FakeVideoProvider;
  let emit: ReturnType<typeof vi.spyOn>;
  let auditRecord: ReturnType<typeof vi.spyOn>;
  const jwtSecret = randomBytes(32).toString('hex');

  let nikola: SignedIn;
  let milica: SignedIn;
  let jovan: SignedIn;
  let ana: SignedIn;
  let ivana: SignedIn;

  /** The 500-seat occurrence and its meetings. */
  let webinarId: string;
  let sessionId: string;
  let primaryId: string;
  let replicaIds: string[];
  const joins = new Map<string, WebinarJoinResponse>();

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('nestself_csrf='))?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  async function switchContext(who: SignedIn, context: Record<string, string>) {
    const res = await who.agent.post('/api/auth/context').set('X-CSRF-Token', who.csrf).send({ context });
    expect(res.status).toBe(200);
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
    await switchContext(who, context);
    return who;
  }

  async function signInMember(userId: string): Promise<SignedIn> {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent.post('/api/auth/email-otp/verify').send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    const who = { agent, csrf: extractCsrf(verify) };
    // The member's own context in ORG: organization with an organization-workspace
    // grant, otherwise personal with the org (CMS EE context rulings).
    const manages = (verify.body.availableContexts as Array<{ kind: string; orgId?: string }>).some(
      (c) => c.kind === 'organization' && c.orgId === ORG,
    );
    await switchContext(who, manages ? { kind: 'organization', orgId: ORG } : { kind: 'personal', orgId: ORG });
    return who;
  }

  const post = (who: SignedIn, path: string, body: unknown = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body as object);

  function emitted(event: string): [string, string, Record<string, unknown>][] {
    return (emit.mock.calls as [string, string, Record<string, unknown>][]).filter((call) => call[1] === event);
  }

  function occurrence(capacity: number) {
    const startsAt = new Date(Date.now() + 5 * MINUTE);
    return {
      title: { en: 'Sleep and recovery for a large audience' },
      presenterUserIds: ['user_milica'],
      moderatorUserId: 'user_nikola',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 60 * MINUTE).toISOString(),
      timeZone: 'Europe/Belgrade',
      audiencePolicy: { type: 'organization', orgIds: [ORG] },
      capacity,
    };
  }

  async function join(who: SignedIn): Promise<WebinarJoinResponse> {
    const res = await post(who, `/webinars/${webinarId}/join`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return WebinarJoinResponseSchema.parse(res.body);
  }

  function capabilitiesIn(meetingId: string, attendeeId: string): unknown {
    return (video as unknown as AttendeeLookup).findAttendee(meetingId, attendeeId)?.Capabilities;
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'webinars_replication');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.VIDEO_PROVIDER = 'none';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebinarJobSchedulerService)
      .useFactory({ factory: () => new WebinarJobSchedulerService({ get: () => undefined } as unknown as ConfigService) })
      .compile();
    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    video = app.get<FakeVideoProvider>(VIDEO_PROVIDER);
    emit = vi.spyOn(app.get(RoomEmitter), 'emit');
    auditRecord = vi.spyOn(app.get(AuditWriter), 'record');

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    const staffLogin = { password: SAMPLE_DEV_PASSWORD, totpSecret: TOTP_SECRET, totpEnrolled: true };
    idp.seedUsers(
      SAMPLE_EXTERNAL_IDENTITIES.filter((i) => PEOPLE.includes(i.userId)).map((i) => ({
        email: i.email,
        sub: i.subject,
        username: i.cognitoUsername,
        ...(STAFF.includes(i.userId) ? staffLogin : {}),
      })),
    );

    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    milica = await signInStaff('user_milica', { kind: 'expert' });
    jovan = await signInMember('user_jovan');
    ana = await signInMember('user_ana');
    ivana = await signInMember('user_ivana');
  }, 180_000);

  beforeEach(() => {
    const throttles = app.get<ThrottlerStorageService>(ThrottlerStorage, { strict: false });
    throttles.storage.clear();
    (throttles as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('the form refuses a capacity of 1,001 with capacity_above_limit and the limit (D-CW-14)', async () => {
    const res = await post(nikola, '/ops/webinars', occurrence(WEBINAR_REPLICATED_CAPACITY + 1));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body).toMatchObject({
      code: 'capacity_above_limit',
      details: { field: 'capacity', limit: WEBINAR_REPLICATED_CAPACITY },
    });
    expect(res.body.message).not.toMatch(/M3/);
  });

  it('the form takes a capacity of 500; three attendees register', async () => {
    const created = await post(nikola, '/ops/webinars', occurrence(500));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.capacity).toBe(500);
    webinarId = created.body.id as string;
    expect((await post(nikola, `/ops/webinars/${webinarId}/publish`)).status).toBe(200);
    for (const who of [jovan, ana, ivana]) {
      const res = await post(who, `/webinars/${webinarId}/register`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
  });

  it('the first host join creates one primary and two replicas; hosts land on the primary', async () => {
    const createSession = vi.spyOn(video, 'createSession');
    expect((await post(milica, `/webinars/${webinarId}/start`)).status).toBe(200);

    const presenter = await join(milica);
    joins.set('milica', presenter);
    sessionId = presenter.sessionId;
    primaryId = `fake-meeting-${sessionId}`;
    replicaIds = [`${primaryId}-r1`, `${primaryId}-r2`];

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0]![0]).toMatchObject({ sessionId, format: 'webinar', capacity: 500 });
    const created = await createSession.mock.results[0]!.value;
    expect(created.replicas.map((r: { providerMeetingId: string; capacity: number }) => [r.providerMeetingId, r.capacity])).toEqual([
      [replicaIds[0], 250],
      [replicaIds[1], 250],
    ]);
    createSession.mockRestore();

    const [row] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, sessionId));
    expect(row).toMatchObject({ providerMeetingId: primaryId, replicaMeetingIds: replicaIds, status: 'ACTIVE' });
    const described = await video.describeSession({ providerMeetingId: primaryId, replicaMeetingIds: replicaIds });
    expect(described?.replicas.map((r) => r.providerMeetingId)).toEqual(replicaIds);

    const moderator = await join(nikola);
    joins.set('nikola', moderator);
    expect(presenter.meeting.MeetingId).toBe(primaryId);
    expect(moderator.meeting.MeetingId).toBe(primaryId);
    expect(presenter.role).toBe('presenter');
    expect(moderator.role).toBe('moderator');
  });

  it('three attendees are spread over the replicas, receive-only, never told the primary', async () => {
    for (const [name, who] of [['jovan', jovan], ['ana', ana], ['ivana', ivana]] as const) {
      joins.set(name, await join(who));
    }
    const meetings = ['jovan', 'ana', 'ivana'].map((name) => joins.get(name)!.meeting.MeetingId);
    expect(meetings).toEqual([replicaIds[0], replicaIds[1], replicaIds[0]]);

    for (const name of ['jovan', 'ana', 'ivana']) {
      const attendee = joins.get(name)!;
      expect(attendee.capabilities).toEqual(RECEIVE_ONLY);
      expect(attendee.meeting).not.toHaveProperty('PrimaryMeetingId');
      expect(capabilitiesIn(attendee.meeting.MeetingId, attendee.attendee.AttendeeId)).toEqual({
        Audio: 'Receive',
        Video: 'Receive',
        Content: 'Receive',
      });
    }

    const seats = await testDb.db
      .select({ userId: callParticipants.userId, replicaIndex: callParticipants.replicaIndex })
      .from(callParticipants)
      .where(eq(callParticipants.sessionId, sessionId))
      .orderBy(asc(callParticipants.userId));
    expect(seats).toEqual([
      { userId: 'user_ana', replicaIndex: 2 },
      { userId: 'user_ivana', replicaIndex: 1 },
      { userId: 'user_jovan', replicaIndex: 1 },
      { userId: 'user_milica', replicaIndex: null },
      { userId: 'user_nikola', replicaIndex: null },
    ]);

    // A rejoin returns the cached seat.
    expect((await join(ana)).meeting.MeetingId).toBe(replicaIds[1]);
  });

  it('the floor promotes a replica attendee onto the primary with audio only; the credentials go to her socket only', async () => {
    const promote = vi.spyOn(video, 'promoteToPrimary');
    const update = vi.spyOn(video, 'updateParticipantCapabilities');
    const attendee = joins.get('ana')!;
    const participantId = attendee.participantId;

    const res = await post(nikola, `/webinars/${webinarId}/participants/${participantId}/give-floor`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The host's response carries no credential.
    expect(res.body).toEqual({ participantId, hasFloor: true, capabilities: FLOOR });

    expect(promote).toHaveBeenCalledWith({ sessionId, providerMeetingId: primaryId, participantId });
    expect(update).not.toHaveBeenCalled();
    const promoted = await promote.mock.results[0]!.value;
    // D-CW-35: audio only, on the primary; the replica seat is unchanged.
    expect(capabilitiesIn(primaryId, promoted.providerAttendeeId)).toEqual({
      Audio: 'SendReceive',
      Video: 'Receive',
      Content: 'Receive',
    });
    expect(capabilitiesIn(replicaIds[1]!, attendee.attendee.AttendeeId)).toEqual({
      Audio: 'Receive',
      Video: 'Receive',
      Content: 'Receive',
    });

    expect(emitted('webinar.floor.given')).toEqual([
      [
        'user:user_ana',
        'webinar.floor.given',
        {
          participantId,
          capabilities: FLOOR,
          primaryAttendee: {
            AttendeeId: promoted.providerAttendeeId,
            ExternalUserId: participantId,
            JoinToken: `fake-token-${participantId}`,
          },
        },
      ],
    ]);
    const [seat] = await testDb.db.select().from(callParticipants).where(eq(callParticipants.id, participantId));
    expect(seat?.floorAttendeeId).toBe(promoted.providerAttendeeId);
    // No token in any audit event.
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain(`fake-token-${participantId}`);
    promote.mockRestore();
    update.mockRestore();
  });

  it('take-floor demotes: the primary attendee is deleted and the replica seat stays', async () => {
    const demote = vi.spyOn(video, 'demoteFromPrimary');
    const attendee = joins.get('ana')!;
    const participantId = attendee.participantId;
    const [before] = await testDb.db.select().from(callParticipants).where(eq(callParticipants.id, participantId));

    const res = await post(milica, `/webinars/${webinarId}/participants/${participantId}/take-floor`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ participantId, hasFloor: false, capabilities: RECEIVE_ONLY });

    expect(demote).toHaveBeenCalledWith({
      sessionId,
      providerMeetingId: primaryId,
      participantId,
      providerAttendeeId: before!.floorAttendeeId,
    });
    expect(capabilitiesIn(primaryId, before!.floorAttendeeId!)).toBeUndefined();
    expect(capabilitiesIn(replicaIds[1]!, attendee.attendee.AttendeeId)).toBeDefined();
    const [after] = await testDb.db.select().from(callParticipants).where(eq(callParticipants.id, participantId));
    expect(after?.floorAttendeeId).toBeNull();
    expect(emitted('webinar.floor.taken').at(-1)).toEqual([
      'user:user_ana',
      'webinar.floor.taken',
      { participantId, capabilities: RECEIVE_ONLY },
    ]);
    demote.mockRestore();
  });

  it('the end deletes the replicas, then the primary', async () => {
    const endSession = vi.spyOn(video, 'endSession');
    const res = await post(milica, `/webinars/${webinarId}/end`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(endSession).toHaveBeenCalledWith({ providerMeetingId: primaryId, replicaMeetingIds: replicaIds });
    for (const meetingId of [primaryId, ...replicaIds]) {
      expect(await video.describeSession({ providerMeetingId: meetingId })).toBeNull();
    }
    const [row] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, sessionId));
    expect(row?.status).toBe('ENDED');
    endSession.mockRestore();
  });
});
