/**
 * Database-level integration tests for the auth schema and the RLS policies.
 *
 * Runs against TEST_DATABASE_URL (nestself_test). Skipped when it is unset.
 * Prerequisites: PostgreSQL 17 reachable with a role that may create
 * databases and roles.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { withOrgScope } from '../../src/db/db.service.js';
import { seed } from '../../src/db/seed/seed-lib.js';
import {
  appointmentApprovals,
  appointments,
  approvalAuthorities,
  callFeedback,
  callOutcomes,
  callParticipants,
  callSessions,
  channels,
  conversationMessages,
  conversations,
  grants,
  intakeRecords,
  organizations,
  orgUnitClosure,
  orgUnits,
  posts,
  webinarMessages,
  webinarPollResults,
  webinarRegistrations,
  webinars,
} from '../../src/db/schema/index.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

describe.skipIf(!shouldRun)('schema integration tests', () => {
  let owner: TestDatabase;
  let app: TestDatabase;

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'schema');
    app = await connectAsAppRole(owner);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  it('migrations apply cleanly on a fresh database', async () => {
    const { rows } = await owner.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    expect(Number(rows[0]!.n)).toBe(14);
  });

  it('"teams" view returns one row per TEAM org unit', async () => {
    await owner.db.insert(organizations).values({ id: 'test_org', name: 'Test Org', slug: 'test-org' });
    await owner.db.insert(orgUnits).values([
      { id: 'ou_test_team', orgId: 'test_org', kind: 'TEAM', name: 'Test Team' },
      { id: 'ou_test_dept', orgId: 'test_org', kind: 'DEPARTMENT', name: 'Test Dept' },
    ]);

    const { rows } = await owner.pool.query<{ id: string; name: string; org_id: string }>(
      'SELECT * FROM teams WHERE org_id = $1',
      ['test_org'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('ou_test_team');
    expect(rows[0]!.name).toBe('Test Team');

    await owner.db.delete(orgUnits).where(eq(orgUnits.orgId, 'test_org'));
    await owner.db.delete(organizations).where(eq(organizations.id, 'test_org'));
  });

  describe('audit_events', () => {
    const insertAudit = (id: string, occurredAt: Date) =>
      owner.pool.query(
        `INSERT INTO audit_events (id, occurred_at, actor_kind, action, record_type, record_id, result, category, details, retain_until)
         VALUES ($1, $2, 'SYSTEM', 'test.action', 'test', $3, 'NONE', 'ADMIN', '{}'::jsonb, $4)`,
        [id, occurredAt, id, new Date(occurredAt.getTime() + 365 * 86_400_000)],
      );

    it('trigger rejects UPDATE', async () => {
      const now = new Date();
      await insertAudit('audit_test_1', now);
      await expect(
        owner.pool.query(
          `UPDATE audit_events SET action = 'modified' WHERE id = 'audit_test_1' AND occurred_at = $1`,
          [now],
        ),
      ).rejects.toThrow(/append-only.*UPDATE is not allowed/i);
    });

    it('trigger rejects DELETE', async () => {
      const now = new Date();
      await insertAudit('audit_test_2', now);
      await expect(
        owner.pool.query(`DELETE FROM audit_events WHERE id = 'audit_test_2' AND occurred_at = $1`, [now]),
      ).rejects.toThrow(/append-only.*DELETE is not allowed/i);
    });

    it('event lands in the correct monthly partition', async () => {
      const oct2026 = new Date('2026-10-15T12:00:00Z');
      await insertAudit('audit_partition_test', oct2026);
      const { rows } = await owner.pool.query<{ partition: string }>(
        `SELECT tableoid::regclass::text AS partition FROM audit_events WHERE id = 'audit_partition_test' AND occurred_at = $1`,
        [oct2026],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.partition).toBe('audit_events_y2026m10');
    });

    it('application role may INSERT but not UPDATE or DELETE (A.3.4)', async () => {
      const { rows } = await owner.pool.query<{ ins: boolean; upd: boolean; del: boolean }>(
        `SELECT has_table_privilege('nestself_app', 'audit_events', 'INSERT') AS ins,
                has_table_privilege('nestself_app', 'audit_events', 'UPDATE') AS upd,
                has_table_privilege('nestself_app', 'audit_events', 'DELETE') AS del`,
      );
      expect(rows[0]).toEqual({ ins: true, upd: false, del: false });
    });
  });

  it('users_email_lowercase_check rejects mixed-case email', async () => {
    await expect(
      owner.pool.query(
        `INSERT INTO users (id, email, display_name) VALUES ('user_casetest', 'MixedCase@Example.com', 'Test')`,
      ),
    ).rejects.toThrow(/users_email_lowercase_check/);
  });

  it('idx_memberships_one_active rejects a second ACTIVE membership for the same user and org', async () => {
    await owner.pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ('user_dup', 'user_dup@example.com', 'Dup')`,
    );
    await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ('org_dup', 'Dup', 'dup')`);
    await owner.pool.query(
      `INSERT INTO memberships (user_id, org_id, status, start_date) VALUES ('user_dup', 'org_dup', 'ACTIVE', '2026-01-01')`,
    );
    await expect(
      owner.pool.query(
        `INSERT INTO memberships (user_id, org_id, status, start_date) VALUES ('user_dup', 'org_dup', 'ACTIVE', '2026-02-01')`,
      ),
    ).rejects.toThrow(/idx_memberships_one_active/);
  });

  describe('row-level security (D-19, D-37)', () => {
    beforeAll(async () => {
      await owner.db.insert(organizations).values([
        { id: 'rls_org_a', name: 'RLS A', slug: 'rls-a' },
        { id: 'rls_org_b', name: 'RLS B', slug: 'rls-b' },
      ]);
      await owner.db.insert(orgUnits).values([
        { id: 'rls_ou_a', orgId: 'rls_org_a', kind: 'COMPANY', name: 'A root' },
        { id: 'rls_ou_b', orgId: 'rls_org_b', kind: 'COMPANY', name: 'B root' },
      ]);
      await owner.pool.query(
        `INSERT INTO users (id, email, display_name) VALUES ('rls_user', 'rls_user@example.com', 'RLS')`,
      );
      await owner.db.insert(grants).values([
        {
          id: 'rls_grant_a',
          subjectUserId: 'rls_user',
          actions: ['program.overview'],
          scopeType: 'organization',
          scopeOrgId: 'rls_org_a',
          grantedByUserId: 'rls_user',
          validFrom: new Date('2026-01-01'),
        },
        {
          id: 'rls_grant_platform',
          subjectUserId: 'rls_user',
          actions: ['preferences.manage'],
          scopeType: 'platform',
          scopeOrgId: null,
          grantedByUserId: 'rls_user',
          validFrom: new Date('2026-01-01'),
        },
      ]);
    });

    it('tenant tables have RLS enabled and forced', async () => {
      const { rows } = await owner.pool.query<{ relname: string; rls: boolean; forced: boolean }>(
        `SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class
         WHERE relname IN ('org_units','memberships','grants','approval_authorities','invitations','sso_connections','channels','event_requests',
                           'posts','polls','poll_options','poll_votes','org_unit_closure',
                           'conversations','conversation_messages','intake_records','appointments',
                           'call_sessions','call_participants','call_events','call_client_events',
                           'call_outcomes','call_feedback','call_consents','appointment_approvals',
                           'webinars','webinar_hosts','webinar_registrations','webinar_messages',
                           'webinar_polls','webinar_poll_options','webinar_poll_results','webinar_recordings')`,
      );
      expect(rows).toHaveLength(33);
      for (const row of rows) {
        expect(row.rls, row.relname).toBe(true);
        expect(row.forced, row.relname).toBe(true);
      }
    });

    it('the application role sees every row without a tenant setting (system context)', async () => {
      const rows = await app.db.select({ id: orgUnits.id }).from(orgUnits);
      expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(['rls_ou_a', 'rls_ou_b']));
    });

    it('withOrgScope limits reads to the organization and keeps platform grants visible', async () => {
      const units = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx.select({ id: orgUnits.id }).from(orgUnits),
      );
      expect(units.map((r) => r.id)).toEqual(['rls_ou_a']);

      const visibleGrants = await withOrgScope(app.db, 'rls_org_b', (tx) =>
        tx.select({ id: grants.id }).from(grants).where(eq(grants.subjectUserId, 'rls_user')),
      );
      expect(visibleGrants.map((g) => g.id)).toEqual(['rls_grant_platform']);
    });

    it('withOrgScope rejects writes for another organization', async () => {
      // Drizzle wraps driver errors in DrizzleQueryError; the Postgres message is the cause.
      const err = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx.insert(orgUnits).values({ id: 'rls_leak', orgId: 'rls_org_b', kind: 'TEAM', name: 'leak' }),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);
      const rows = await owner.db.select({ id: orgUnits.id }).from(orgUnits).where(eq(orgUnits.id, 'rls_leak'));
      expect(rows).toEqual([]);
    });

    it('tables without an org column are isolated through their join (posts, closure)', async () => {
      await owner.db.insert(channels).values([
        { id: 'rls_ch_a', name: 'A general', scope: 'ORGANIZATION', orgId: 'rls_org_a' },
        { id: 'rls_ch_b', name: 'B general', scope: 'ORGANIZATION', orgId: 'rls_org_b' },
      ]);
      await owner.db.insert(posts).values([
        { id: 'rls_post_a', body: 'a', channelId: 'rls_ch_a', authorId: 'rls_user' },
        { id: 'rls_post_b', body: 'b', channelId: 'rls_ch_b', authorId: 'rls_user' },
      ]);
      await owner.db.insert(orgUnitClosure).values([
        { ancestorId: 'rls_ou_a', descendantId: 'rls_ou_a', depth: 0 },
        { ancestorId: 'rls_ou_b', descendantId: 'rls_ou_b', depth: 0 },
      ]);

      const visiblePosts = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx.select({ id: posts.id }).from(posts).where(inArray(posts.id, ['rls_post_a', 'rls_post_b'])),
      );
      expect(visiblePosts.map((p) => p.id)).toEqual(['rls_post_a']);

      const visibleClosure = await withOrgScope(app.db, 'rls_org_b', (tx) =>
        tx
          .select({ ancestorId: orgUnitClosure.ancestorId })
          .from(orgUnitClosure)
          .where(inArray(orgUnitClosure.ancestorId, ['rls_ou_a', 'rls_ou_b'])),
      );
      expect(visibleClosure.map((c) => c.ancestorId)).toEqual(['rls_ou_b']);

      // Writing a post into another organization's channel is rejected.
      const err = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx.insert(posts).values({ id: 'rls_post_leak', body: 'x', channelId: 'rls_ch_b', authorId: 'rls_user' }),
      ).catch((e: unknown) => e);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);

      // System context still sees both rows.
      const all = await app.db.select({ id: posts.id }).from(posts).where(inArray(posts.id, ['rls_post_a', 'rls_post_b']));
      expect(all).toHaveLength(2);
    });

    it('confidential-domain tables are isolated by tenant (conversations, messages, intake)', async () => {
      await owner.db.insert(conversations).values([
        { id: 'rls_conv_a', orgId: 'rls_org_a', caseId: 'rls_case_a', employeeUserId: 'rls_user', expertUserId: 'rls_user' },
        { id: 'rls_conv_b', orgId: 'rls_org_b', caseId: 'rls_case_b', employeeUserId: 'rls_user', expertUserId: 'rls_user' },
      ]);
      await owner.db.insert(conversationMessages).values([
        { id: 'rls_msg_a', conversationId: 'rls_conv_a', authorUserId: 'rls_user', body: 'Sample message (fixture)' },
        { id: 'rls_msg_b', conversationId: 'rls_conv_b', authorUserId: 'rls_user', body: 'Sample message (fixture)' },
      ]);
      await owner.db.insert(intakeRecords).values([
        { id: 'rls_intake_a', orgId: 'rls_org_a', caseId: 'rls_case_a', employeeUserId: 'rls_user', body: 'Sample intake (fixture)' },
        { id: 'rls_intake_b', orgId: 'rls_org_b', caseId: 'rls_case_b', employeeUserId: 'rls_user', body: 'Sample intake (fixture)' },
      ]);

      // The second organization's scoped reads see none of the first one's rows.
      const fromB = await withOrgScope(app.db, 'rls_org_b', async (tx) => ({
        conversations: await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, 'rls_conv_a')),
        messages: await tx
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, 'rls_conv_a')),
        intake: await tx.select({ id: intakeRecords.id }).from(intakeRecords).where(eq(intakeRecords.id, 'rls_intake_a')),
      }));
      expect(fromB).toEqual({ conversations: [], messages: [], intake: [] });

      const fromA = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(inArray(conversationMessages.id, ['rls_msg_a', 'rls_msg_b'])),
      );
      expect(fromA.map((m) => m.id)).toEqual(['rls_msg_a']);

      const rejected = async (write: Parameters<typeof withOrgScope>[2]) => {
        const err = await withOrgScope(app.db, 'rls_org_a', write).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
        expect(cause.message).toMatch(/row-level security policy/);
      };
      await rejected((tx) =>
        tx.insert(conversations).values({
          id: 'rls_conv_leak',
          orgId: 'rls_org_b',
          caseId: 'rls_case_leak',
          employeeUserId: 'rls_user',
          expertUserId: 'rls_user',
        }),
      );
      await rejected((tx) =>
        tx.insert(conversationMessages).values({
          id: 'rls_msg_leak',
          conversationId: 'rls_conv_b',
          authorUserId: 'rls_user',
          body: 'Sample message (fixture)',
        }),
      );
      await rejected((tx) =>
        tx.insert(intakeRecords).values({
          id: 'rls_intake_leak',
          orgId: 'rls_org_b',
          caseId: 'rls_case_leak',
          employeeUserId: 'rls_user',
          body: 'Sample intake (fixture)',
        }),
      );
      const leaked = await owner.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, 'rls_conv_leak'));
      expect(leaked).toEqual([]);
    });

    it('appointments are isolated by tenant (CW-R-19)', async () => {
      const appointment = {
        expertUserId: 'rls_user',
        employeeUserId: 'rls_user',
        startsAt: new Date('2026-11-10T15:00:00Z'),
        endsAt: new Date('2026-11-10T15:50:00Z'),
        serviceCategory: 'psychological',
      };
      await owner.db.insert(appointments).values([
        { ...appointment, id: 'rls_appt_a', orgId: 'rls_org_a' },
        { ...appointment, id: 'rls_appt_b', orgId: 'rls_org_b' },
      ]);

      const fromB = await withOrgScope(app.db, 'rls_org_b', (tx) =>
        tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(inArray(appointments.id, ['rls_appt_a', 'rls_appt_b'])),
      );
      expect(fromB.map((a) => a.id)).toEqual(['rls_appt_b']);

      const err = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx.insert(appointments).values({ ...appointment, id: 'rls_appt_leak', orgId: 'rls_org_b' }),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);

      // Status defaults to CONFIRMED; an appointment must end after it starts.
      const [stored] = await owner.db.select().from(appointments).where(eq(appointments.id, 'rls_appt_a'));
      expect(stored).toMatchObject({ status: 'CONFIRMED', timeZone: 'Europe/Belgrade', followUpOf: null });
      await expect(
        owner.db
          .insert(appointments)
          .values({ ...appointment, id: 'rls_appt_reversed', orgId: 'rls_org_a', endsAt: appointment.startsAt }),
      ).rejects.toThrow();
    });

    it('call tables are isolated by tenant and keep no join token (T-CW-1.1, D-CW-25)', async () => {
      const session = {
        format: 'CONSULTATION' as const,
        startsAt: new Date('2026-11-10T15:00:00Z'),
        endsAt: new Date('2026-11-10T15:50:00Z'),
      };
      await owner.db.insert(callSessions).values([
        { ...session, id: 'rls_call_a', appointmentId: 'rls_appt_a', orgId: 'rls_org_a' },
        { ...session, id: 'rls_call_b', appointmentId: 'rls_appt_b', orgId: 'rls_org_b' },
      ]);
      await owner.db.insert(callParticipants).values([
        { id: 'rls_part_a', sessionId: 'rls_call_a', orgId: 'rls_org_a', userId: 'rls_user', role: 'EMPLOYEE' },
        { id: 'rls_part_b', sessionId: 'rls_call_b', orgId: 'rls_org_b', userId: 'rls_user', role: 'EMPLOYEE' },
      ]);

      const fromA = await withOrgScope(app.db, 'rls_org_a', async (tx) => ({
        sessions: await tx.select({ id: callSessions.id }).from(callSessions),
        participants: await tx.select({ id: callParticipants.id }).from(callParticipants),
      }));
      expect(fromA.sessions.map((r) => r.id)).toEqual(['rls_call_a']);
      expect(fromA.participants.map((r) => r.id)).toEqual(['rls_part_a']);

      const leak = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx.insert(callFeedback).values({ sessionId: 'rls_call_b', orgId: 'rls_org_b', userId: 'rls_user', score: 4 }),
      ).catch((e: unknown) => e);
      expect(leak).toBeInstanceOf(Error);
      const cause = (leak as Error & { cause?: Error }).cause ?? (leak as Error);
      expect(cause.message).toMatch(/row-level security policy/);

      // A consultation session needs its appointment and organization; one live session per appointment.
      await expect(
        owner.db.insert(callSessions).values({ ...session, id: 'rls_call_orphan', orgId: 'rls_org_a' }),
      ).rejects.toThrow();
      await expect(
        owner.db.insert(callSessions).values({ ...session, id: 'rls_call_dup', appointmentId: 'rls_appt_a', orgId: 'rls_org_a' }),
      ).rejects.toThrow();
      // A failed session does not block the next one.
      await owner.db.update(callSessions).set({ status: 'FAILED' }).where(eq(callSessions.id, 'rls_call_a'));
      await owner.db
        .insert(callSessions)
        .values({ ...session, id: 'rls_call_retry', appointmentId: 'rls_appt_a', orgId: 'rls_org_a' });

      // Feedback scores stay within 1 to 5; one outcome per session.
      await expect(
        owner.db.insert(callFeedback).values({ sessionId: 'rls_call_a', orgId: 'rls_org_a', userId: 'rls_user', score: 6 }),
      ).rejects.toThrow();
      await owner.db
        .insert(callOutcomes)
        .values({ sessionId: 'rls_call_a', orgId: 'rls_org_a', status: 'COMPLETED', recordedByUserId: 'rls_user' });
      await expect(
        owner.db
          .insert(callOutcomes)
          .values({ sessionId: 'rls_call_a', orgId: 'rls_org_a', status: 'CANCELED', recordedByUserId: 'rls_user' }),
      ).rejects.toThrow();

      // CW-R-13: no call column can hold a join token or credentials.
      const { rows } = await owner.pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'call\\_%'`,
      );
      expect(rows.length).toBeGreaterThan(40);
      for (const { column_name } of rows) {
        expect(column_name, column_name).not.toMatch(/token|credential|secret/);
      }
    });

    it('webinar tables keep platform-wide occurrences visible and organisation rows isolated (T-CW-2.1, D-CW-25)', async () => {
      const base = {
        title: { en: 'Webinar' },
        audiencePolicy: { type: 'all_eligible' as const },
        startsAt: new Date('2026-11-20T15:00:00Z'),
        endsAt: new Date('2026-11-20T16:00:00Z'),
        timeZone: 'Europe/Belgrade',
        createdByUserId: 'rls_user',
      };
      await owner.db.insert(webinars).values([
        { ...base, id: 'rls_webinar_all', orgId: null },
        { ...base, id: 'rls_webinar_a', orgId: 'rls_org_a', audiencePolicy: { type: 'organization', orgIds: ['rls_org_a'] } },
        { ...base, id: 'rls_webinar_b', orgId: 'rls_org_b', audiencePolicy: { type: 'organization', orgIds: ['rls_org_b'] } },
      ]);
      await owner.db.insert(webinarRegistrations).values([
        { id: 'rls_reg_all_a', webinarId: 'rls_webinar_all', orgId: 'rls_org_a', userId: 'rls_user', registeredAt: base.startsAt },
        { id: 'rls_reg_b', webinarId: 'rls_webinar_b', orgId: 'rls_org_b', userId: 'rls_user', registeredAt: base.startsAt },
      ]);

      // Every webinar is recorded (D-CW-34): the column starts SCHEDULED and there is no recording switch.
      const [created] = await owner.db.select().from(webinars).where(eq(webinars.id, 'rls_webinar_all'));
      expect(created).toMatchObject({ status: 'DRAFT', recordingStatus: 'SCHEDULED', capacity: 250, chatPolicy: 'moderated' });
      expect(Object.keys(created!)).not.toContain('recordingPolicy');

      const fromA = await withOrgScope(app.db, 'rls_org_a', async (tx) => ({
        webinars: await tx.select({ id: webinars.id }).from(webinars),
        registrations: await tx.select({ id: webinarRegistrations.id }).from(webinarRegistrations),
      }));
      expect(fromA.webinars.map((r) => r.id).sort()).toEqual(['rls_webinar_a', 'rls_webinar_all']);
      // A registration carries the registrant's organisation, even for an occurrence open to all.
      expect(fromA.registrations.map((r) => r.id)).toEqual(['rls_reg_all_a']);

      const leak = await withOrgScope(app.db, 'rls_org_a', (tx) =>
        tx.insert(webinarMessages).values({
          webinarId: 'rls_webinar_b',
          orgId: 'rls_org_b',
          authorUserId: 'rls_user',
          kind: 'ATTENDEE',
          text: 'leak',
        }),
      ).catch((e: unknown) => e);
      expect(leak).toBeInstanceOf(Error);
      const cause = (leak as Error & { cause?: Error }).cause ?? (leak as Error);
      expect(cause.message).toMatch(/row-level security policy/);

      // A registration always carries the registrant's organisation (migration 0013): no platform-wide registration.
      await expect(
        owner.db
          .insert(webinarRegistrations)
          .values({ webinarId: 'rls_webinar_all', orgId: null as unknown as string, userId: 'rls_user', registeredAt: base.startsAt }),
      ).rejects.toThrow();
      const { rows: policies } = await owner.pool.query<{ qual: string }>(
        `SELECT qual FROM pg_policies WHERE tablename = 'webinar_registrations'`,
      );
      expect(policies.map((p) => p.qual).join(' ')).not.toMatch(/IS NULL/);

      // One registration per person and occurrence (CW-R-24a); capacity within 1 to 1,000; host posts are published.
      await expect(
        owner.db
          .insert(webinarRegistrations)
          .values({ webinarId: 'rls_webinar_b', orgId: 'rls_org_b', userId: 'rls_user', registeredAt: base.startsAt }),
      ).rejects.toThrow();
      await expect(owner.db.insert(webinars).values({ ...base, id: 'rls_webinar_huge', capacity: 1001 })).rejects.toThrow();
      await expect(
        owner.db
          .insert(webinarMessages)
          .values({ webinarId: 'rls_webinar_all', authorUserId: 'rls_user', kind: 'HOST', status: 'PENDING', text: 'x' }),
      ).rejects.toThrow();

      // CW-R-24: a vote row names the poll and the option, never the voter or a time.
      const { rows: voteColumns } = await owner.pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'webinar_poll_results' ORDER BY column_name`,
      );
      expect(voteColumns.map((r) => r.column_name)).toEqual(['id', 'option_id', 'org_id', 'poll_id']);
      expect(Object.keys(webinarPollResults)).not.toContain('userId');
    });

    it('0012: a webinar session names an existing occurrence; a message can lose its author (T-CW-2.5, D-CW-29)', async () => {
      const window = { startsAt: new Date('2026-11-20T15:00:00Z'), endsAt: new Date('2026-11-20T16:00:00Z') };
      await expect(
        owner.db.insert(callSessions).values({ ...window, id: 'rls_ws_ghost', format: 'WEBINAR', webinarId: 'no_such_webinar' }),
      ).rejects.toThrow();
      await owner.db
        .insert(callSessions)
        .values({ ...window, id: 'rls_ws_all', format: 'WEBINAR', webinarId: 'rls_webinar_all', orgId: null });

      // The 12-month anonymisation removes the author link and keeps the message.
      await owner.db
        .insert(webinarMessages)
        .values({ id: 'rls_msg_anon', webinarId: 'rls_webinar_all', authorUserId: 'rls_user', kind: 'ATTENDEE', text: 'kept' });
      await owner.db.update(webinarMessages).set({ authorUserId: null }).where(eq(webinarMessages.id, 'rls_msg_anon'));
      const [anon] = await owner.db.select().from(webinarMessages).where(eq(webinarMessages.id, 'rls_msg_anon'));
      expect(anon).toMatchObject({ authorUserId: null, text: 'kept' });
      // Leave the seed assertions below their own webinar session.
      await owner.db.delete(webinarMessages).where(eq(webinarMessages.id, 'rls_msg_anon'));
      await owner.db.delete(callSessions).where(eq(callSessions.id, 'rls_ws_all'));

      const { rows } = await owner.pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'webinar_recordings' ORDER BY column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(
        expect.arrayContaining([
          'provider_pipeline_arn',
          'concatenation_pipeline_id',
          'concatenated_key',
          'handoff_status',
          'handoff_location',
          'failure_reason',
          'failed_at',
        ]),
      );
    });

    it('the tenant setting does not leak out of the transaction', async () => {
      await withOrgScope(app.db, 'rls_org_a', async () => undefined);
      const rows = await app.db.select({ id: orgUnits.id }).from(orgUnits);
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('seed', () => {
    it('closure invariant AUTHZ-R-09: every org unit is its own ancestor at depth 0', async () => {
      const counts = await seed(owner.db);
      expect(counts.orgUnits).toBeGreaterThan(0);

      const { rows } = await owner.pool.query<{ missing: string }>(
        `SELECT ou.id AS missing FROM org_units ou
         WHERE NOT EXISTS (
           SELECT 1 FROM org_unit_closure c WHERE c.ancestor_id = ou.id AND c.descendant_id = ou.id AND c.depth = 0
         ) AND ou.id LIKE 'ou_%' OR ou.id LIKE 'team_%' AND NOT EXISTS (
           SELECT 1 FROM org_unit_closure c WHERE c.ancestor_id = ou.id AND c.descendant_id = ou.id AND c.depth = 0
         )`,
      );
      expect(rows).toEqual([]);
    });

    it('seeds the sample appointments and the consultation call session (T-CW-1.1)', async () => {
      // Earlier tests in this file add their own rows, so the counts are lower bounds.
      const counts = await seed(owner.db);
      expect(counts.appointments).toBeGreaterThanOrEqual(5);
      expect(counts.callFeedback).toBeGreaterThanOrEqual(1);

      const appointmentRows = await owner.db
        .select({ id: appointments.id, status: appointments.status })
        .from(appointments)
        .where(inArray(appointments.id, ['appt_sample_completed', 'appt_sample_upcoming']));
      expect(appointmentRows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: 'appt_sample_completed', status: 'COMPLETED' },
        { id: 'appt_sample_upcoming', status: 'CONFIRMED' },
      ]);

      const [session] = await owner.db
        .select()
        .from(callSessions)
        .where(eq(callSessions.id, 'call_session_sample_consultation'));
      expect(session).toMatchObject({ format: 'CONSULTATION', status: 'ENDED', appointmentId: 'appt_sample_completed' });
      // The webinar session of the ended sample webinar (T-CW-2.1).
      const webinarSessions = await owner.db.select().from(callSessions).where(eq(callSessions.format, 'WEBINAR'));
      expect(webinarSessions.map((s) => [s.id, s.webinarId])).toEqual([['call_session_sample_webinar', 'webinar_sample_ended']]);

      const [outcome] = await owner.db
        .select()
        .from(callOutcomes)
        .where(eq(callOutcomes.sessionId, 'call_session_sample_consultation'));
      expect(outcome).toMatchObject({ status: 'COMPLETED', recordedByUserId: 'user_milica' });
      const roles = await owner.db
        .select({ role: callParticipants.role })
        .from(callParticipants)
        .where(eq(callParticipants.sessionId, 'call_session_sample_consultation'));
      expect(roles.map((r) => r.role).sort()).toEqual(['EMPLOYEE', 'EXPERT']);

      // T-CW-1.5: the sample approver's authority and pending item for the awaiting_approval follow-up.
      const [approval] = await owner.db
        .select()
        .from(appointmentApprovals)
        .where(eq(appointmentApprovals.id, 'approval_sample_follow_up_awaiting'));
      expect(approval).toMatchObject({
        appointmentId: 'appt_sample_follow_up_awaiting',
        approverUserId: 'user_ivana',
        status: 'PENDING',
        orgId: 'org_sample',
      });
      const [authority] = await owner.db
        .select()
        .from(approvalAuthorities)
        .where(eq(approvalAuthorities.id, 'approval_authority_sample_ivana'));
      expect(authority).toMatchObject({ userId: 'user_ivana', orgUnitId: 'ou_root', includeDescendants: true });
      const [approverGrant] = await owner.db.select().from(grants).where(eq(grants.id, 'grant_user_ivana_approver'));
      expect(approverGrant).toMatchObject({ templateKey: 'approver', scopeOrgId: 'org_sample' });
    });

    it('seeds the sample webinars, their chat and the poll with anonymous votes (T-CW-2.1)', async () => {
      const counts = await seed(owner.db);
      expect(counts.webinars).toBeGreaterThanOrEqual(2);
      expect(counts.webinarMessages).toBeGreaterThanOrEqual(5);
      expect(counts.webinarPollResults).toBeGreaterThanOrEqual(2);

      const rows = await owner.db
        .select({ id: webinars.id, orgId: webinars.orgId, status: webinars.status, recordingStatus: webinars.recordingStatus })
        .from(webinars)
        .where(inArray(webinars.id, ['webinar_sample_upcoming', 'webinar_sample_ended']));
      expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: 'webinar_sample_ended', orgId: 'org_sample', status: 'ENDED', recordingStatus: 'SCHEDULED' },
        { id: 'webinar_sample_upcoming', orgId: null, status: 'PUBLISHED', recordingStatus: 'SCHEDULED' },
      ]);
      const pending = await owner.db
        .select({ id: webinarMessages.id })
        .from(webinarMessages)
        .where(eq(webinarMessages.status, 'PENDING'));
      expect(pending.map((m) => m.id)).toContain('webinar_message_sample_5');
      const registrations = await owner.db
        .select({ userId: webinarRegistrations.userId })
        .from(webinarRegistrations)
        .where(eq(webinarRegistrations.webinarId, 'webinar_sample_ended'));
      expect(registrations.map((r) => r.userId).sort()).toEqual(['user_ana', 'user_jovan']);
    });

    it('is idempotent (run twice, row counts equal)', async () => {
      const counts1 = await seed(owner.db);
      const counts2 = await seed(owner.db);
      expect(counts2).toEqual(counts1);
    });

    it('removes the over-privileged grants that seeds before the legacy-role fix created', async () => {
      await seed(owner.db);
      const stale = {
        subjectUserId: 'user_jovan',
        actions: ['people.invite'],
        scopeType: 'organization',
        scopeOrgId: 'org_sample',
        grantedByUserId: 'user_ivana',
        validFrom: new Date('2026-01-01'),
      };
      await owner.db.insert(grants).values([
        { ...stale, id: 'grant_user_jovan_employer_owner', templateKey: 'employer_owner' },
        { ...stale, id: 'grant_user_jovan_approver', templateKey: 'approver' },
        { ...stale, id: 'grant_explicit_jovan_approver', templateKey: 'approver' },
      ]);

      await seed(owner.db);

      const rows = await owner.db
        .select({ id: grants.id })
        .from(grants)
        .where(eq(grants.subjectUserId, 'user_jovan'));
      expect(rows.map((r) => r.id).sort()).toEqual(['grant_explicit_jovan_approver', 'grant_user_jovan_employee']);
      await owner.db.delete(grants).where(eq(grants.id, 'grant_explicit_jovan_approver'));
    });
  });
});
