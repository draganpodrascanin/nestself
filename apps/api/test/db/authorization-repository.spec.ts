/**
 * DB-backed AuthorizationRepository tests (item 3, T-C1.02).
 *
 * - findActiveOrgGrantTemplateKeys excludes revoked, expired, future grants.
 * - findOrgNames returns names only for the requested ids.
 *
 * Requires TEST_DATABASE_URL. Follows the existing pattern with
 * `resetTestDatabase()` / `connectAsAppRole()`.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetTestDatabase, connectAsAppRole, type TestDatabase } from './test-database.js';
import * as t from '../../src/db/schema/index.js';
import { AuthorizationRepository } from '../../src/db/repositories/authorization.repository.js';
import type { DbService } from '../../src/db/db.service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

describe.skipIf(!shouldRun)('AuthorizationRepository (item 3, T-C1.02)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;
  let repo: AuthorizationRepository;

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'authz_repo');
    app = await connectAsAppRole(owner);

    // Wire up the repository using the app-role connection.
    const dbService = { db: app.db } as DbService;
    repo = new AuthorizationRepository(dbService);

    // Seed minimal data: org, user, memberships, permission_templates, grants.
    await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ('repo_org', 'Repo Org', 'repo-org')`);
    await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ('repo_org_b', 'Repo Org B', 'repo-org-b')`);
    await owner.pool.query(`INSERT INTO users (id, email, display_name) VALUES ('repo_user', 'repo_user@example.com', 'Repo User')`);
    await owner.pool.query(
      `INSERT INTO memberships (user_id, org_id, status, start_date) VALUES ('repo_user', 'repo_org', 'ACTIVE', '2026-01-01')`,
    );

    // Permission templates referenced by grants (FK constraint).
    for (const key of ['hr_admin', 'team_manager', 'employee', 'approver']) {
      await owner.pool.query(
        `INSERT INTO permission_templates (id, key, name, workspace, population, actions, scope_type, requires_second_factor, step_up_actions, is_active)
         VALUES ($1, $2, $3, 'organization', 'employer_admin', '{}', 'organization', false, '{}', true)`,
        [`tmpl_${key}`, key, key],
      );
    }

    const now = new Date();
    const past = new Date('2025-01-01');
    const future = new Date('2099-01-01');

    // Active grant (should be included).
    await owner.db.insert(t.grants).values({
      id: 'g_active',
      subjectUserId: 'repo_user',
      templateKey: 'hr_admin',
      actions: ['program.overview'],
      scopeType: 'organization',
      scopeOrgId: 'repo_org',
      grantedByUserId: 'repo_user',
      validFrom: past,
    });

    // Revoked grant (should be excluded).
    await owner.db.insert(t.grants).values({
      id: 'g_revoked',
      subjectUserId: 'repo_user',
      templateKey: 'team_manager',
      actions: ['events.request'],
      scopeType: 'organization',
      scopeOrgId: 'repo_org',
      grantedByUserId: 'repo_user',
      validFrom: past,
      revokedAt: now,
    });

    // Expired grant (validUntil in the past).
    await owner.db.insert(t.grants).values({
      id: 'g_expired',
      subjectUserId: 'repo_user',
      templateKey: 'employee',
      actions: ['content.read'],
      scopeType: 'organization',
      scopeOrgId: 'repo_org',
      grantedByUserId: 'repo_user',
      validFrom: past,
      validUntil: past,
    });

    // Future grant (validFrom in the future).
    await owner.db.insert(t.grants).values({
      id: 'g_future',
      subjectUserId: 'repo_user',
      templateKey: 'approver',
      actions: ['approval.decide'],
      scopeType: 'organization',
      scopeOrgId: 'repo_org',
      grantedByUserId: 'repo_user',
      validFrom: future,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  // ── findActiveOrgGrantTemplateKeys ──────────────────────────────────────

  describe('findActiveOrgGrantTemplateKeys', () => {
    it('returns only the active, unrevoked, current grant template keys', async () => {
      const now = new Date();
      const result = await repo.findActiveOrgGrantTemplateKeys(
        'repo_user',
        ['repo_org'],
        now,
      );

      const keys = result.map((r) => r.templateKey);
      expect(keys).toContain('hr_admin');
      expect(keys).not.toContain('team_manager'); // revoked
      expect(keys).not.toContain('employee'); // expired
      expect(keys).not.toContain('approver'); // future
    });

    it('does not return grants scoped to other orgs', async () => {
      const now = new Date();
      const result = await repo.findActiveOrgGrantTemplateKeys(
        'repo_user',
        ['repo_org_b'],
        now,
      );
      expect(result).toHaveLength(0);
    });
  });

  // ── findOrgNames ────────────────────────────────────────────────────────

  describe('findOrgNames', () => {
    it('returns names for the given ids only', async () => {
      const names = await repo.findOrgNames(['repo_org']);
      expect(names.get('repo_org')).toBe('Repo Org');
      expect(names.has('repo_org_b')).toBe(false);
    });

    it('returns names for multiple ids', async () => {
      const names = await repo.findOrgNames(['repo_org', 'repo_org_b']);
      expect(names.get('repo_org')).toBe('Repo Org');
      expect(names.get('repo_org_b')).toBe('Repo Org B');
    });

    it('returns empty map for empty input', async () => {
      const names = await repo.findOrgNames([]);
      expect(names.size).toBe(0);
    });
  });
});
