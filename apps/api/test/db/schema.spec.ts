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
  appointments,
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
    expect(Number(rows[0]!.n)).toBe(8);
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
                           'call_outcomes','call_feedback','call_consents')`,
      );
      expect(rows).toHaveLength(24);
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
