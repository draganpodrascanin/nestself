import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApiClient } from './client';
import { createOrgAdminApi } from './org-admin';

const GRANT = {
  id: 'grant_1',
  subjectUserId: 'user_1',
  templateKey: 'employee',
  actions: ['content.read'],
  scopeType: 'organization',
  scopeOrgId: 'org_1',
  scopeOrgUnitId: null,
  includeDescendants: false,
  conditions: [],
  validFrom: null,
  validUntil: null,
  parentGrantId: null,
  grantedByUserId: 'user_2',
  grantedAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null,
};

interface Call {
  url: string;
  method: string;
  csrf: string | null;
  body: unknown;
}

function recorder(responseBody: unknown) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      csrf: new Headers(init?.headers).get('X-CSRF-Token'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl });
  return { client, last: () => calls[calls.length - 1]! };
}

function setup(responseBody: unknown, kind: 'org') {
  const { client, last } = recorder(responseBody);
  return { last, api: createOrgAdminApi(client, { kind }) };
}

function setupOps(responseBody: unknown) {
  const { client, last } = recorder(responseBody);
  return { last, api: createOrgAdminApi(client, { kind: 'ops' }) };
}

describe('createOrgAdminApi', () => {
  const originalDocument = globalThis.document;
  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: { cookie: 'nestself_csrf=tok' },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  });

  describe('org kind', () => {
    it('lists members with query parameters, GET without CSRF', async () => {
      const { api, last } = setup({ items: [], nextCursor: null }, 'org');
      await api.listMembers('org_1', { limit: 10, status: 'ACTIVE', search: 'an' });
      expect(last().method).toBe('GET');
      expect(last().url).toBe('http://x/api/orgs/org_1/members?limit=10&status=ACTIVE&search=an');
      expect(last().csrf).toBeNull();
    });

    it('lists org units and unwraps items', async () => {
      const unit = { id: 'u', orgId: 'org_1', parentId: null, kind: 'COMPANY', name: 'A', costCenterCode: null, archivedAt: null };
      const { api, last } = setup({ items: [unit] }, 'org');
      await expect(api.listOrgUnits('org_1')).resolves.toEqual([unit]);
      expect(last().url).toBe('http://x/api/orgs/org_1/org-units');
    });

    it('lists grants with subjectUserId and includeRevoked', async () => {
      const { api, last } = setup({ items: [GRANT] }, 'org');
      const res = await api.listGrants('org_1', { subjectUserId: 'user_1', includeRevoked: true });
      expect(res.items).toHaveLength(1);
      expect(last().url).toBe('http://x/api/orgs/org_1/grants?subjectUserId=user_1&includeRevoked=true');
    });

    it('lists grants without a query string', async () => {
      const { api, last } = setup({ items: [] }, 'org');
      await api.listGrants('org_1');
      expect(last().url).toBe('http://x/api/orgs/org_1/grants');
    });

    it('creates a grant with POST, CSRF and JSON body', async () => {
      const { api, last } = setup(GRANT, 'org');
      const body = { templateKey: 'employee', subjectUserId: 'user_1', scopeType: 'organization' as const, includeDescendants: false, conditions: [] };
      await api.createGrant('org_1', body);
      expect(last().method).toBe('POST');
      expect(last().url).toBe('http://x/api/orgs/org_1/grants');
      expect(last().csrf).toBe('tok');
      expect(last().body).toEqual(body);
    });

    it('updates a grant with PATCH', async () => {
      const { api, last } = setup(GRANT, 'org');
      await api.updateGrant('org_1', 'grant_1', { validUntil: '2027-01-01T00:00:00.000Z' });
      expect(last().method).toBe('PATCH');
      expect(last().url).toBe('http://x/api/orgs/org_1/grants/grant_1');
      expect(last().csrf).toBe('tok');
    });

    it('revokes a grant with a reason', async () => {
      const { api, last } = setup({ ...GRANT, revokedAt: '2026-02-01T00:00:00.000Z' }, 'org');
      await api.revokeGrant('org_1', 'grant_1', { reason: 'left team' });
      expect(last().method).toBe('POST');
      expect(last().url).toBe('http://x/api/orgs/org_1/grants/grant_1/revoke');
      expect(last().body).toEqual({ reason: 'left team' });
      expect(last().csrf).toBe('tok');
    });

    it('delegates a grant', async () => {
      const { api, last } = setup(GRANT, 'org');
      await api.delegateGrant('org_1', { parentGrantId: 'grant_1', subjectUserId: 'user_3', actions: ['content.read'], conditions: [] });
      expect(last().method).toBe('POST');
      expect(last().url).toBe('http://x/api/orgs/org_1/grants/delegate');
    });

    it('previews access with userId', async () => {
      const { api, last } = setup({ userId: 'user_1', orgId: 'org_1', actions: [], grantIds: [], assignmentIds: [] }, 'org');
      await api.previewAccess('org_1', 'user_1');
      expect(last().method).toBe('GET');
      expect(last().url).toBe('http://x/api/orgs/org_1/grants/preview?userId=user_1');
    });

    it('manages approval authorities', async () => {
      const authority = {
        id: 'aa_1', userId: 'user_1', orgId: 'org_1', orgUnitId: null, includeDescendants: false, categories: [],
        maxAmountMinor: null, currency: null, validFrom: null, validUntil: null, delegatedFromId: null,
        alternateUserId: null, isConfidentialApprover: false,
      };
      const list = setup({ items: [authority] }, 'org');
      await list.api.listApprovalAuthorities('org_1');
      expect(list.last().url).toBe('http://x/api/orgs/org_1/approval-authorities');
      expect(list.last().method).toBe('GET');

      const create = setup(authority, 'org');
      await create.api.createApprovalAuthority('org_1', { userId: 'user_1', includeDescendants: false, categories: [], isConfidentialApprover: false });
      expect(create.last().method).toBe('POST');
      expect(create.last().url).toBe('http://x/api/orgs/org_1/approval-authorities');
      expect(create.last().csrf).toBe('tok');

      const update = setup(authority, 'org');
      await update.api.updateApprovalAuthority('org_1', 'aa_1', { categories: ['travel'] });
      expect(update.last().method).toBe('PATCH');
      expect(update.last().url).toBe('http://x/api/orgs/org_1/approval-authorities/aa_1');
    });

    it('transfers ownership with POST, CSRF and the new owner', async () => {
      const { api, last } = setup({ revokedGrantId: 'grant_old', createdGrant: { ...GRANT, templateKey: 'employer_owner' } }, 'org');
      const res = await api.transferOwnership('org_1', { newOwnerUserId: 'user_3' });
      expect(res.revokedGrantId).toBe('grant_old');
      expect(res.createdGrant.templateKey).toBe('employer_owner');
      expect(last().method).toBe('POST');
      expect(last().url).toBe('http://x/api/orgs/org_1/grants/transfer-ownership');
      expect(last().csrf).toBe('tok');
      expect(last().body).toEqual({ newOwnerUserId: 'user_3' });
    });

    it('encodes path segments', async () => {
      const { api, last } = setup({ items: [] }, 'org');
      await api.listGrants('a/b');
      expect(last().url).toBe('http://x/api/orgs/a%2Fb/grants');
    });

    it('rejects a response that does not match the schema', async () => {
      const { api } = setup({ items: [{ id: 'x' }] }, 'org');
      await expect(api.listGrants('org_1')).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('has no ops-only methods', () => {
      const { api } = setup({}, 'org');
      expect('listPlatformGrants' in api).toBe(false);
      expect('userAccess' in api).toBe(false);
    });
  });

  describe('ops kind', () => {
    it('uses the ops org prefix for members and grants', async () => {
      const members = setupOps({ items: [], nextCursor: null });
      await members.api.listMembers('org_1');
      expect(members.last().url).toBe('http://x/api/ops/orgs/org_1/members');

      const grants = setupOps({ items: [] });
      await grants.api.listGrants('org_1', { includeRevoked: false });
      expect(grants.last().url).toBe('http://x/api/ops/orgs/org_1/grants?includeRevoked=false');

      const create = setupOps(GRANT);
      await create.api.createGrant('org_1', { templateKey: 'employee', subjectUserId: 'user_1', scopeType: 'organization', includeDescendants: false, conditions: [] });
      expect(create.last().url).toBe('http://x/api/ops/orgs/org_1/grants');
      expect(create.last().csrf).toBe('tok');

      const revoke = setupOps(GRANT);
      await revoke.api.revokeGrant('org_1', 'grant_1', { reason: 'no longer needed' });
      expect(revoke.last().url).toBe('http://x/api/ops/orgs/org_1/grants/grant_1/revoke');

      const preview = setupOps({ userId: 'user_1', orgId: 'org_1', actions: [], grantIds: [], assignmentIds: [] });
      await preview.api.previewAccess('org_1', 'user_1');
      expect(preview.last().url).toBe('http://x/api/ops/orgs/org_1/grants/preview?userId=user_1');
    });

    it('lists and creates platform grants', async () => {
      const list = setupOps({ items: [GRANT] });
      await list.api.listPlatformGrants({ subjectUserId: 'user_9' });
      expect(list.last().url).toBe('http://x/api/ops/grants?subjectUserId=user_9');

      const create = setupOps(GRANT);
      await create.api.createPlatformGrant({ templateKey: 'operations', subjectUserId: 'user_9', scopeType: 'platform', conditions: [] });
      expect(create.last().method).toBe('POST');
      expect(create.last().url).toBe('http://x/api/ops/grants');
      expect(create.last().csrf).toBe('tok');
    });

    it('revokes a platform grant with a reason', async () => {
      const { api, last } = setupOps(GRANT);
      await api.revokePlatformGrant('grant/9', { reason: 'off-boarded' });
      expect(last().method).toBe('POST');
      expect(last().url).toBe('http://x/api/ops/grants/grant%2F9/revoke');
      expect(last().csrf).toBe('tok');
      expect(last().body).toEqual({ reason: 'off-boarded' });
    });

    it('transfers ownership through the ops route; a null revokedGrantId parses', async () => {
      const { api, last } = setupOps({ revokedGrantId: null, createdGrant: { ...GRANT, templateKey: 'employer_owner' } });
      const res = await api.transferOwnership('org_1', { newOwnerUserId: 'user_3' });
      expect(res.revokedGrantId).toBeNull();
      expect(last().method).toBe('POST');
      expect(last().url).toBe('http://x/api/ops/orgs/org_1/grants/transfer-ownership');
      expect(last().csrf).toBe('tok');
      expect(last().body).toEqual({ newOwnerUserId: 'user_3' });
    });

    it('reads user access', async () => {
      const { api, last } = setupOps({ userId: 'user_1', contexts: [] });
      await expect(api.userAccess('user_1')).resolves.toEqual({ userId: 'user_1', contexts: [] });
      expect(last().url).toBe('http://x/api/ops/users/user_1/access');
      expect(last().method).toBe('GET');
    });
  });
});
