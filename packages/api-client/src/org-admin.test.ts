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

const INVITATION = {
  id: 'inv_1',
  email: 'newhire@example.com',
  orgId: 'org_1',
  orgUnitId: null,
  templateKey: 'employee',
  expiresAt: '2026-11-01T00:00:00.000Z',
  revokedAt: null,
  acceptedAt: null,
  invitedByUserId: 'user_2',
  createdAt: '2026-10-25T00:00:00.000Z',
};

const MEMBER = {
  membershipId: 'm_1',
  userId: 'user_1',
  displayName: 'Sample Person',
  email: 'sample@example.com',
  orgUnitId: 'u_2',
  costCenterUnitId: null,
  lineManagerUserId: null,
  status: 'ACTIVE',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: null,
};

const MEMBER_END = {
  membershipId: 'm_1',
  status: 'ENDED',
  endDate: '2026-10-25T00:00:00.000Z',
  endedReason: 'LEFT',
  revokedGrantIds: ['grant_1'],
};

const ORG_UNIT = { id: 'u_2', orgId: 'org_1', parentId: 'u_1', kind: 'TEAM', name: 'Team', costCenterCode: null, archivedAt: null };

const ORGANIZATION = { id: 'org_1', name: 'Example', slug: 'example', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z' };

const EMERGENCY = {
  id: 'ea_1',
  userId: 'user_9',
  approvedByUserId: null,
  purpose: 'Safeguarding review of one case',
  scopeKind: 'CASE',
  scopeId: 'case_1',
  durationMinutes: 60,
  grantedAt: '2026-10-25T00:00:00.000Z',
  approvedAt: null,
  expiresAt: '2026-10-25T01:00:00.000Z',
  revokedAt: null,
};

const SSO_DOMAIN = {
  id: 'sd_1',
  domain: 'example.test',
  verifiedAt: null,
  txtRecordName: '_nestself-verify.example.test',
  txtRecordValue: 'nestself-domain-verification=abc',
};

const SSO_CONNECTION = {
  id: 'sso_1',
  orgId: 'org_1',
  protocol: 'SAML',
  cognitoProviderName: 'org-example-saml',
  status: 'DRAFT',
  metadataUrl: 'https://idp.example.test/metadata',
  oidcIssuer: null,
  oidcClientId: null,
  idpInitiatedAllowed: false,
  jitProvisioning: false,
  oidcEmailVerifiedClaimRequired: true,
  defaultOrgUnitId: null,
  certificateExpiresAt: null,
  lastTestedAt: null,
  domains: [SSO_DOMAIN],
  spMetadata: { entityId: 'urn:amazon:cognito:sp:pool', acsUrl: 'https://auth.example.test/saml2/idpresponse' },
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

    describe('invitations', () => {
      it('lists pending invitations with cursor and limit, GET without CSRF', async () => {
        const { api, last } = setup({ items: [INVITATION], nextCursor: 'inv_1' }, 'org');
        const res = await api.listInvitations('org_1', { cursor: 'inv_0', limit: 10 });
        expect(res.nextCursor).toBe('inv_1');
        expect(last().method).toBe('GET');
        expect(last().url).toBe('http://x/api/orgs/org_1/invitations?cursor=inv_0&limit=10');
        expect(last().csrf).toBeNull();
      });

      it('lists invitations without a query string', async () => {
        const { api, last } = setup({ items: [], nextCursor: null }, 'org');
        await api.listInvitations('org_1');
        expect(last().url).toBe('http://x/api/orgs/org_1/invitations');
      });

      it('creates an invitation with POST, CSRF and body, keeping devToken', async () => {
        const { api, last } = setup({ ...INVITATION, devToken: 'dev' }, 'org');
        const body = { email: 'newhire@example.com', templateKey: 'employee', orgUnitId: 'u_2' };
        const res = await api.createInvitation('org_1', body);
        expect(res.devToken).toBe('dev');
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/orgs/org_1/invitations');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual(body);
      });

      it('imports invitations and parses the report', async () => {
        const report = { created: 1, skipped: 1, errors: [{ email: 'x@example.com', reason: 'owner_exists' }] };
        const { api, last } = setup(report, 'org');
        const body = { invitations: [{ email: 'a@example.com', templateKey: 'employee' }] };
        await expect(api.importInvitations('org_1', body)).resolves.toEqual(report);
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/orgs/org_1/invitations/import');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual(body);
      });

      it('revokes an invitation with DELETE and CSRF', async () => {
        const { api, last } = setup({ ...INVITATION, revokedAt: '2026-10-26T00:00:00.000Z' }, 'org');
        const res = await api.revokeInvitation('org_1', 'inv/1');
        expect(res.revokedAt).not.toBeNull();
        expect(last().method).toBe('DELETE');
        expect(last().url).toBe('http://x/api/orgs/org_1/invitations/inv%2F1');
        expect(last().csrf).toBe('tok');
      });

      it('rejects an invitation list that does not match the schema', async () => {
        const { api } = setup({ items: [{ id: 'inv_1' }], nextCursor: null }, 'org');
        await expect(api.listInvitations('org_1')).rejects.toMatchObject({ code: 'invalid_response' });
      });
    });

    describe('members', () => {
      it('updates a member with PATCH, CSRF and body', async () => {
        const { api, last } = setup(MEMBER, 'org');
        const res = await api.updateMember('org_1', 'm_1', { orgUnitId: 'u_2', lineManagerUserId: null });
        expect(res.orgUnitId).toBe('u_2');
        expect(last().method).toBe('PATCH');
        expect(last().url).toBe('http://x/api/orgs/org_1/members/m_1');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ orgUnitId: 'u_2', lineManagerUserId: null });
      });

      it('ends a member with a reason', async () => {
        const { api, last } = setup(MEMBER_END, 'org');
        const res = await api.endMember('org_1', 'm_1', { reason: 'LEFT' });
        expect(res.revokedGrantIds).toEqual(['grant_1']);
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/orgs/org_1/members/m_1/end');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ reason: 'LEFT' });
      });

      it('ends a member with an empty body so the server default applies', async () => {
        const { api, last } = setup({ ...MEMBER_END, endedReason: 'DEACTIVATED_BY_HR' }, 'org');
        await api.endMember('org_1', 'm_1');
        expect(last().body).toEqual({});
      });

      it('rejects an end response with an unknown reason', async () => {
        const { api } = setup({ ...MEMBER_END, endedReason: 'FIRED' }, 'org');
        await expect(api.endMember('org_1', 'm_1')).rejects.toMatchObject({ code: 'invalid_response' });
      });
    });

    describe('org units', () => {
      it('creates an org unit with POST, CSRF and body', async () => {
        const { api, last } = setup(ORG_UNIT, 'org');
        const body = { parentId: 'u_1', kind: 'TEAM' as const, name: 'Team' };
        await expect(api.createOrgUnit('org_1', body)).resolves.toEqual(ORG_UNIT);
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/orgs/org_1/org-units');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual(body);
      });

      it('renames an org unit with PATCH', async () => {
        const { api, last } = setup({ ...ORG_UNIT, name: 'Renamed' }, 'org');
        await api.updateOrgUnit('org_1', 'u_2', { name: 'Renamed', costCenterCode: null });
        expect(last().method).toBe('PATCH');
        expect(last().url).toBe('http://x/api/orgs/org_1/org-units/u_2');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ name: 'Renamed', costCenterCode: null });
      });

      it('moves an org unit with POST .../move', async () => {
        const { api, last } = setup({ ...ORG_UNIT, parentId: 'u_3' }, 'org');
        const res = await api.moveOrgUnit('org_1', 'u_2', { parentId: 'u_3' });
        expect(res.parentId).toBe('u_3');
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/orgs/org_1/org-units/u_2/move');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ parentId: 'u_3' });
      });

      it('rejects an org unit response with an unknown kind', async () => {
        const { api } = setup({ ...ORG_UNIT, kind: 'SQUAD' }, 'org');
        await expect(api.moveOrgUnit('org_1', 'u_2', { parentId: 'u_3' })).rejects.toMatchObject({ code: 'invalid_response' });
      });
    });

    it('has no ops-only methods', () => {
      const { api } = setup({}, 'org');
      expect('listPlatformGrants' in api).toBe(false);
      expect('userAccess' in api).toBe(false);
      for (const name of [
        'listOrganizations', 'getOrganization', 'suspendUser', 'reinstateUser', 'listEmergencyAccess',
        'requestEmergencyAccess', 'approveEmergencyAccess', 'denyEmergencyAccess', 'revokeEmergencyAccess',
        'readEmergencyRecord', 'listSsoConnections', 'createSsoConnection', 'updateSsoConnection', 'addSsoDomain',
        'verifySsoDomain', 'testSsoConnection', 'activateSsoConnection',
      ]) {
        expect(name in api).toBe(false);
      }
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
      const { api, last } = setupOps({ userId: 'user_1', suspended: false, contexts: [] });
      await expect(api.userAccess('user_1')).resolves.toEqual({ userId: 'user_1', suspended: false, contexts: [] });
      expect(last().url).toBe('http://x/api/ops/users/user_1/access');
      expect(last().method).toBe('GET');
    });

    it('has no org-only methods (the ops mirror has no member update or org-unit routes)', () => {
      const { api } = setupOps({});
      for (const name of ['updateMember', 'createOrgUnit', 'updateOrgUnit', 'moveOrgUnit', 'listOrgUnits']) {
        expect(name in api).toBe(false);
      }
    });

    describe('invitations and members through the ops prefix', () => {
      it('lists, creates, imports and revokes invitations', async () => {
        const list = setupOps({ items: [INVITATION], nextCursor: null });
        await list.api.listInvitations('org_1', { limit: 5 });
        expect(list.last().method).toBe('GET');
        expect(list.last().url).toBe('http://x/api/ops/orgs/org_1/invitations?limit=5');
        expect(list.last().csrf).toBeNull();

        const create = setupOps(INVITATION);
        await create.api.createInvitation('org_1', { email: 'a@example.com', templateKey: 'employee' });
        expect(create.last().method).toBe('POST');
        expect(create.last().url).toBe('http://x/api/ops/orgs/org_1/invitations');
        expect(create.last().csrf).toBe('tok');
        expect(create.last().body).toEqual({ email: 'a@example.com', templateKey: 'employee' });

        const imp = setupOps({ created: 1, skipped: 0, errors: [] });
        await imp.api.importInvitations('org_1', { invitations: [{ email: 'a@example.com', templateKey: 'employee' }] });
        expect(imp.last().url).toBe('http://x/api/ops/orgs/org_1/invitations/import');
        expect(imp.last().csrf).toBe('tok');

        const revoke = setupOps(INVITATION);
        await revoke.api.revokeInvitation('org_1', 'inv_1');
        expect(revoke.last().method).toBe('DELETE');
        expect(revoke.last().url).toBe('http://x/api/ops/orgs/org_1/invitations/inv_1');
        expect(revoke.last().csrf).toBe('tok');
      });

      it('ends a member through the ops route', async () => {
        const { api, last } = setupOps(MEMBER_END);
        await api.endMember('org_1', 'm_1', { reason: 'SUSPENDED_BY_PLATFORM' });
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/orgs/org_1/members/m_1/end');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ reason: 'SUSPENDED_BY_PLATFORM' });
      });
    });

    describe('organizations', () => {
      it('lists organizations with search and cursor, GET without CSRF', async () => {
        const { api, last } = setupOps({ items: [ORGANIZATION], nextCursor: null });
        const res = await api.listOrganizations({ search: 'exa', cursor: 'org_0', limit: 20 });
        expect(res.items).toEqual([ORGANIZATION]);
        expect(last().method).toBe('GET');
        expect(last().url).toBe('http://x/api/ops/organizations?search=exa&cursor=org_0&limit=20');
        expect(last().csrf).toBeNull();
      });

      it('drops an empty search instead of sending search=', async () => {
        const { api, last } = setupOps({ items: [], nextCursor: null });
        await api.listOrganizations({ search: '' });
        expect(last().url).toBe('http://x/api/ops/organizations');
      });

      it('reads one organization', async () => {
        const { api, last } = setupOps(ORGANIZATION);
        await expect(api.getOrganization('org/1')).resolves.toEqual(ORGANIZATION);
        expect(last().method).toBe('GET');
        expect(last().url).toBe('http://x/api/ops/organizations/org%2F1');
      });

      it('rejects an organization with an unknown status', async () => {
        const { api } = setupOps({ ...ORGANIZATION, status: 'DELETED' });
        await expect(api.getOrganization('org_1')).rejects.toMatchObject({ code: 'invalid_response' });
      });
    });

    describe('users', () => {
      it('suspends a user with a reason', async () => {
        const { api, last } = setupOps({ userId: 'user_1', suspendedAt: '2026-10-25T00:00:00.000Z' });
        const res = await api.suspendUser('user_1', { reason: 'security review' });
        expect(res.suspendedAt).toBe('2026-10-25T00:00:00.000Z');
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/users/user_1/suspend');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ reason: 'security review' });
      });

      it('reinstates a user with POST and no body', async () => {
        const { api, last } = setupOps({ userId: 'user_1', reinstatedAt: '2026-10-26T00:00:00.000Z' });
        await api.reinstateUser('user_1');
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/users/user_1/reinstate');
        expect(last().csrf).toBe('tok');
        expect(last().body).toBeUndefined();
      });

      it('rejects a suspend response without suspendedAt', async () => {
        const { api } = setupOps({ userId: 'user_1' });
        await expect(api.suspendUser('user_1', { reason: 'security review' })).rejects.toMatchObject({ code: 'invalid_response' });
      });
    });

    describe('emergency access', () => {
      it('lists emergency access, optionally for one requester', async () => {
        const all = setupOps({ items: [EMERGENCY] });
        await all.api.listEmergencyAccess();
        expect(all.last().method).toBe('GET');
        expect(all.last().url).toBe('http://x/api/ops/emergency-access');
        expect(all.last().csrf).toBeNull();

        const mine = setupOps({ items: [] });
        await mine.api.listEmergencyAccess({ userId: 'user_9' });
        expect(mine.last().url).toBe('http://x/api/ops/emergency-access?userId=user_9');
      });

      it('requests emergency access with POST, CSRF and body', async () => {
        const { api, last } = setupOps(EMERGENCY);
        const body = { purpose: 'Safeguarding review of one case', scopeKind: 'CASE' as const, scopeId: 'case_1', durationMinutes: 60 };
        await api.requestEmergencyAccess(body);
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/emergency-access');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual(body);
      });

      it('requests without a duration so the server default applies', async () => {
        const { api, last } = setupOps(EMERGENCY);
        await api.requestEmergencyAccess({ purpose: 'Safeguarding review of one case', scopeKind: 'USER_RECORDS', scopeId: 'user_1' });
        expect(last().body).not.toHaveProperty('durationMinutes');
      });

      it('approves and revokes with POST and CSRF', async () => {
        const approve = setupOps({ ...EMERGENCY, approvedByUserId: 'user_8', approvedAt: '2026-10-25T00:10:00.000Z' });
        const approved = await approve.api.approveEmergencyAccess('ea_1');
        expect(approved.approvedByUserId).toBe('user_8');
        expect(approve.last().method).toBe('POST');
        expect(approve.last().url).toBe('http://x/api/ops/emergency-access/ea_1/approve');
        expect(approve.last().csrf).toBe('tok');

        const revoke = setupOps({ ...EMERGENCY, revokedAt: '2026-10-25T00:20:00.000Z' });
        await revoke.api.revokeEmergencyAccess('ea_1');
        expect(revoke.last().method).toBe('POST');
        expect(revoke.last().url).toBe('http://x/api/ops/emergency-access/ea_1/revoke');
        expect(revoke.last().csrf).toBe('tok');
      });

      it('denies with POST and CSRF and resolves undefined (204)', async () => {
        const { api, last } = setupOps({});
        await expect(api.denyEmergencyAccess('ea_1')).resolves.toBeUndefined();
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/emergency-access/ea_1/deny');
        expect(last().csrf).toBe('tok');
      });

      it('reads one record under emergency access', async () => {
        const record = { emergencyAccessId: 'ea_1', recordType: 'conversation', recordId: 'conv_1', content: { id: 'conv_1', messages: [] } };
        const { api, last } = setupOps(record);
        await expect(api.readEmergencyRecord('ea_1', 'conversation', 'conv_1')).resolves.toEqual(record);
        expect(last().method).toBe('GET');
        expect(last().url).toBe('http://x/api/ops/emergency-access/ea_1/records/conversation/conv_1');
        expect(last().csrf).toBeNull();
      });

      it('rejects an emergency record with an unknown record type', async () => {
        const { api } = setupOps({ emergencyAccessId: 'ea_1', recordType: 'payroll', recordId: 'x', content: null });
        await expect(api.readEmergencyRecord('ea_1', 'conversation', 'x')).rejects.toMatchObject({ code: 'invalid_response' });
      });
    });
    describe('SSO connections', () => {
      it('lists connections, optionally for one organization, GET without CSRF', async () => {
        const all = setupOps({ items: [SSO_CONNECTION] });
        const res = await all.api.listSsoConnections();
        expect(res.items).toEqual([SSO_CONNECTION]);
        expect(all.last().method).toBe('GET');
        expect(all.last().url).toBe('http://x/api/ops/sso-connections');
        expect(all.last().csrf).toBeNull();

        const one = setupOps({ items: [] });
        await one.api.listSsoConnections({ orgId: 'org/1' });
        expect(one.last().url).toBe('http://x/api/ops/sso-connections?orgId=org%2F1');
      });

      it('creates a connection with POST, CSRF and body', async () => {
        const { api, last } = setupOps(SSO_CONNECTION);
        const body = { orgId: 'org_1', slug: 'example', protocol: 'SAML' as const, metadataUrl: 'https://idp.example.test/metadata' };
        await expect(api.createSsoConnection(body)).resolves.toEqual(SSO_CONNECTION);
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/sso-connections');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual(body);
      });

      it('updates a connection with PATCH, CSRF and body', async () => {
        const { api, last } = setupOps({ ...SSO_CONNECTION, status: 'SUSPENDED' });
        const res = await api.updateSsoConnection('sso/1', { status: 'SUSPENDED' });
        expect(res.status).toBe('SUSPENDED');
        expect(last().method).toBe('PATCH');
        expect(last().url).toBe('http://x/api/ops/sso-connections/sso%2F1');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ status: 'SUSPENDED' });
      });

      it('adds a domain and returns the TXT record', async () => {
        const { api, last } = setupOps(SSO_DOMAIN);
        const res = await api.addSsoDomain('sso_1', { domain: 'example.test' });
        expect(res.txtRecordName).toBe('_nestself-verify.example.test');
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/sso-connections/sso_1/domains');
        expect(last().csrf).toBe('tok');
        expect(last().body).toEqual({ domain: 'example.test' });
      });

      it('verifies a domain with POST and no body', async () => {
        const { api, last } = setupOps({ ...SSO_DOMAIN, verifiedAt: '2026-10-25T00:00:00.000Z' });
        const res = await api.verifySsoDomain('sso_1', 'sd_1');
        expect(res.verifiedAt).toBe('2026-10-25T00:00:00.000Z');
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/sso-connections/sso_1/domains/sd_1/verify');
        expect(last().csrf).toBe('tok');
        expect(last().body).toBeUndefined();
      });

      it('starts a test and returns the start URL', async () => {
        const { api, last } = setupOps({ startUrl: 'http://api.example.test/api/auth/sso/start?connection=org-example-saml' });
        const res = await api.testSsoConnection('sso_1');
        expect(res.startUrl).toMatch(/^http:\/\/api\.example\.test/);
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/sso-connections/sso_1/test');
        expect(last().csrf).toBe('tok');
        expect(last().body).toBeUndefined();
      });

      it('activates a tested connection with POST', async () => {
        const { api, last } = setupOps({ ...SSO_CONNECTION, status: 'ACTIVE' });
        const res = await api.activateSsoConnection('sso_1');
        expect(res.status).toBe('ACTIVE');
        expect(last().method).toBe('POST');
        expect(last().url).toBe('http://x/api/ops/sso-connections/sso_1/activate');
        expect(last().csrf).toBe('tok');
      });

      it('rejects a connection with an unknown status', async () => {
        const { api } = setupOps({ items: [{ ...SSO_CONNECTION, status: 'PAUSED' }] });
        await expect(api.listSsoConnections()).rejects.toMatchObject({ code: 'invalid_response' });
      });

      it('rejects a test response without an absolute start URL', async () => {
        const { api } = setupOps({ startUrl: '/relative' });
        await expect(api.testSsoConnection('sso_1')).rejects.toMatchObject({ code: 'invalid_response' });
      });
    });
  });
});
