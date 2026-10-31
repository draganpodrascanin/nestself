/**
 * MembershipsRepository.listMembers against a real PostgreSQL database,
 * connected as the non-superuser app role so that row-level security applies:
 * the search term is a literal prefix of the name or the email, never a LIKE
 * pattern.
 *
 * Runs against TEST_DATABASE_URL. Skipped when it is unset.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withOrgScope, type DbService } from '../../src/db/db.service.js';
import { seed } from '../../src/db/seed/seed-lib.js';
import { memberships, users } from '../../src/db/schema/index.js';
import { MembershipsRepository } from '../../src/db/repositories/memberships.repository.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';

/** Names that hold the characters LIKE treats specially, next to look-alikes a wildcard would match. */
const SEARCH_PEOPLE = [
  { id: 'user_search_percent', displayName: '%Percent first', email: 'percent.first@search.example' },
  { id: 'user_search_underscore', displayName: '_Underscore first', email: 'underscore.first@search.example' },
  { id: 'user_search_backslash', displayName: '\\Backslash first', email: 'backslash.first@search.example' },
  { id: 'user_search_discount', displayName: '50% discount', email: 'discount@search.example' },
  { id: 'user_search_five_hundred', displayName: '500 dollars', email: 'dollars@search.example' },
  { id: 'user_search_a_b', displayName: 'a_b exact', email: 'a_b@search.example' },
  { id: 'user_search_axb', displayName: 'axb look-alike', email: 'axb@search.example' },
];

describe.skipIf(!shouldRun)('MembershipsRepository.listMembers search (db)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;
  let repo: MembershipsRepository;

  /** Display names the search returns for the organization, sorted. */
  async function search(term: string): Promise<string[]> {
    const rows = await withOrgScope(app.db, ORG, (tx) =>
      repo.listMembers({ orgId: ORG, limit: 100, search: term }, tx),
    );
    return rows.map((r) => r.displayName).sort();
  }

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'membersearch');
    await seed(owner.db);
    await owner.db.insert(users).values(SEARCH_PEOPLE);
    await owner.db.insert(memberships).values(
      SEARCH_PEOPLE.map((p) => ({
        userId: p.id,
        orgId: ORG,
        status: 'ACTIVE' as const,
        startDate: new Date('2026-01-01T00:00:00Z'),
      })),
    );
    app = await connectAsAppRole(owner);
    repo = new MembershipsRepository({ db: app.db } as unknown as DbService);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  it('a plain term is a case-insensitive prefix of the name', async () => {
    expect(await search('ana')).toEqual(['Ana Nikolić']);
    expect(await search('AXB')).toEqual(['axb look-alike']);
  });

  it('a plain term is also a prefix of the email', async () => {
    expect(await search('USER_ANA@')).toEqual(['Ana Nikolić']);
    expect(await search('discount@')).toEqual(['50% discount']);
  });

  it('a percent sign matches only a percent sign, not any run of characters', async () => {
    expect(await search('%')).toEqual(['%Percent first']);
    expect(await search('50%')).toEqual(['50% discount']);
  });

  it('an underscore matches only an underscore, not any single character', async () => {
    expect(await search('_')).toEqual(['_Underscore first']);
    expect(await search('a_b')).toEqual(['a_b exact']);
  });

  it('a backslash matches only a backslash, and does not escape the wildcard after it', async () => {
    expect(await search('\\')).toEqual(['\\Backslash first']);
  });

  it('a term with no match returns nothing', async () => {
    expect(await search('%zzz')).toEqual([]);
  });
});
