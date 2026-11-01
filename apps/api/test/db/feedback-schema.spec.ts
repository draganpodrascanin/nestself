/**
 * Database-level integration tests for the feedback cases schema (migration
 * 0022; ADR 0002, spec Epic F). Tenant isolation under forced RLS, the
 * constraints that keep a route staffed by two different people and a
 * reporter message anonymous, and the absence of any reporter column on the
 * tables a handler path reads. Requires TEST_DATABASE_URL.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withOrgScope } from '../../src/db/db.service.js';
import { feedbackCaseReporters, feedbackCases, feedbackMessages, feedbackRoutes, organizations } from '../../src/db/schema/index.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

/** The database's own message of a refused write (Drizzle wraps it in "Failed query"). */
async function driverError(write: PromiseLike<unknown>): Promise<string> {
  const err = await Promise.resolve(write).then(() => null, (e: unknown) => e);
  expect(err, 'the write should have failed').toBeInstanceOf(Error);
  return ((err as Error & { cause?: Error }).cause ?? (err as Error)).message;
}

describe.skipIf(!shouldRun)('feedback cases schema (migration 0022)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'feedback');
    app = await connectAsAppRole(owner);
    await owner.db.insert(organizations).values([
      { id: 'fb_org_a', name: 'FB A', slug: 'fb-a' },
      { id: 'fb_org_b', name: 'FB B', slug: 'fb-b' },
    ]);
    await owner.pool.query(
      `INSERT INTO users (id, email, display_name) VALUES
         ('fb_primary', 'fb_primary@example.com', 'Primary'),
         ('fb_alternate', 'fb_alternate@example.com', 'Alternate'),
         ('fb_reporter', 'fb_reporter@example.com', 'Reporter')`,
    );
    await owner.db.insert(feedbackRoutes).values({
      id: 'fb_route_a',
      orgId: 'fb_org_a',
      kind: 'standard',
      categories: ['workload'],
      primaryHandlerUserId: 'fb_primary',
      alternateHandlerUserId: 'fb_alternate',
      enabled: true,
    });
    await owner.db.insert(feedbackCases).values({
      id: 'fb_case_a',
      orgId: 'fb_org_a',
      routeId: 'fb_route_a',
      kind: 'problem',
      category: 'workload',
      pseudonym: 'Reporter-AB2C',
      routeChoice: 'alternate',
      handlerUserId: 'fb_alternate',
      dueAt: new Date('2026-11-06T09:00:00Z'),
    });
    await owner.db.insert(feedbackCaseReporters).values({ caseId: 'fb_case_a', orgId: 'fb_org_a', reporterUserId: 'fb_reporter' });
    await owner.db.insert(feedbackMessages).values({ id: 'fb_msg_a', caseId: 'fb_case_a', orgId: 'fb_org_a', sender: 'reporter', authorUserId: null, body: 'x', internal: false });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  it('another organization sees none of the four tables rows', async () => {
    await withOrgScope(app.db, 'fb_org_b', async (tx) => {
      expect(await tx.select().from(feedbackRoutes)).toHaveLength(0);
      expect(await tx.select().from(feedbackCases)).toHaveLength(0);
      expect(await tx.select().from(feedbackCaseReporters)).toHaveLength(0);
      expect(await tx.select().from(feedbackMessages)).toHaveLength(0);
    });
    await withOrgScope(app.db, 'fb_org_a', async (tx) => {
      expect(await tx.select().from(feedbackCases).where(eq(feedbackCases.id, 'fb_case_a'))).toHaveLength(1);
    });
  });

  it('a tenant cannot write a case into another organization', async () => {
    const message = await driverError(
      withOrgScope(app.db, 'fb_org_b', (tx) =>
        tx.insert(feedbackCases).values({
          id: 'fb_case_cross',
          orgId: 'fb_org_a',
          routeId: 'fb_route_a',
          kind: 'problem',
          category: 'workload',
          pseudonym: 'Reporter-ZZZZ',
          routeChoice: 'primary',
        }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('the handler-facing tables carry no reporter column', async () => {
    const { rows } = await owner.pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('feedback_cases', 'feedback_messages') ORDER BY table_name, column_name`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toEqual(expect.arrayContaining(['reporter_user_id', 'user_id', 'membership_id', 'email']));
    expect(rows.filter((r) => r.table_name === 'feedback_cases').map((r) => r.column_name)).toContain('pseudonym');
  });

  it('a route needs two different recipients and one row per kind', async () => {
    const same = await driverError(
      owner.db
        .insert(feedbackRoutes)
        .values({ id: 'fb_route_same', orgId: 'fb_org_b', kind: 'standard', primaryHandlerUserId: 'fb_primary', alternateHandlerUserId: 'fb_primary' }),
    );
    expect(same).toMatch(/feedback_routes_handlers_check/);
    const duplicate = await driverError(
      owner.db
        .insert(feedbackRoutes)
        .values({ id: 'fb_route_dup', orgId: 'fb_org_a', kind: 'standard', primaryHandlerUserId: 'fb_primary', alternateHandlerUserId: 'fb_alternate' }),
    );
    expect(duplicate).toMatch(/feedback_routes_org_id_kind_key/);
  });

  it('a reporter message carries no author and only a handler writes internal notes', async () => {
    const signed = await driverError(
      owner.db.insert(feedbackMessages).values({ id: 'fb_msg_signed', caseId: 'fb_case_a', orgId: 'fb_org_a', sender: 'reporter', authorUserId: 'fb_reporter', body: 'x' }),
    );
    expect(signed).toMatch(/feedback_messages_reporter_anonymous_check/);
    const internal = await driverError(
      owner.db.insert(feedbackMessages).values({ id: 'fb_msg_internal', caseId: 'fb_case_a', orgId: 'fb_org_a', sender: 'system', authorUserId: null, body: 'x', internal: true }),
    );
    expect(internal).toMatch(/feedback_messages_internal_check/);
  });

  it('a case accepts only the two route choices', async () => {
    const bad = await driverError(
      owner.db
        .insert(feedbackCases)
        .values({ id: 'fb_case_bad', orgId: 'fb_org_a', routeId: 'fb_route_a', kind: 'problem', category: 'x', pseudonym: 'Reporter-AAAA', routeChoice: 'manager' }),
    );
    expect(bad).toMatch(/feedback_cases_route_choice_check/);
  });
});
