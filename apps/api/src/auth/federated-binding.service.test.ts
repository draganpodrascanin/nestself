/**
 * FederatedBindingService unit tests: the binding paths (invitation, JIT,
 * nothing), the denial (orphan deleted, `identity.denied`) and the two checks
 * around a binding, with the real fake identity provider, the real
 * InvitationMembershipActivator and repository fakes. The callback paths that
 * use them are covered in sso-callback.service.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { IdentityProviderError, type IdTokenClaims } from '../identity/identity-provider.service.js';
import { InvitationMembershipActivator } from '../invitations/invitation-membership-activator.js';
import { FederatedBindingService, domainOf, sameEmail } from './federated-binding.service.js';

const PROVIDER = 'org-acme-oidc';
const META = { ip: '127.0.0.1', userAgent: 'vitest' };

type Conn = {
  id: string;
  orgId: string;
  cognitoProviderName: string;
  protocol: 'SAML' | 'OIDC';
  status: 'DRAFT' | 'TESTING' | 'ACTIVE' | 'SUSPENDED';
  jitProvisioning: boolean;
  defaultOrgUnitId: string | null;
};

function connection(overrides: Partial<Conn> = {}): Conn {
  return {
    id: 'conn_1',
    orgId: 'org_sample',
    cognitoProviderName: PROVIDER,
    protocol: 'OIDC',
    status: 'ACTIVE',
    jitProvisioning: false,
    defaultOrgUnitId: 'unit_1',
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    email: 'new@acme.example',
    orgId: 'org_sample',
    orgUnitId: 'unit_2',
    templateKey: 'employee',
    invitedByUserId: 'user_ivana',
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

const CLAIMS: IdTokenClaims = {
  sub: 'idp-subject-1',
  email: 'new@acme.example',
  emailVerified: true,
  identities: [{ providerName: PROVIDER, userId: 'idp-subject-1' }],
  username: `${PROVIDER}_idp-subject-1`,
  authTime: 0,
};

function setup() {
  const idp = new FakeIdentityProvider({ apiPublicUrl: 'http://api.test' });
  const tx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'membership_1' }]) }),
    }),
  };
  const sso = {
    findDomainByName: vi.fn(async (domain: string) =>
      domain === 'acme.example' ? { connectionId: 'conn_1', verifiedAt: new Date(), domain } : null,
    ),
  };
  const identities = {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ id: 'user_new' }),
    createExternalIdentity: vi.fn().mockResolvedValue({}),
  };
  const invitations = {
    findPendingByEmailAndOrg: vi.fn().mockResolvedValue(null),
    accept: vi.fn().mockResolvedValue({}),
  };
  const memberships = { findByUserId: vi.fn().mockResolvedValue([]) };
  const authz = { createGrant: vi.fn().mockResolvedValue({}), findActiveOwnerGrants: vi.fn().mockResolvedValue([]) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const activator = new InvitationMembershipActivator(
    invitations as never, memberships as never, authz as never, audit as never,
  );
  const service = new FederatedBindingService(
    idp, sso as never, identities as never, invitations as never, activator, audit as never, memberships as never,
  );
  return { service, idp, tx, sso, identities, invitations, memberships, authz, audit };
}

type Ctx = ReturnType<typeof setup>;

/** Each audit action with whether it was written through the binding transaction. */
function auditTransactions(ctx: Ctx): Array<[string, boolean]> {
  return (ctx.audit.record.mock.calls as unknown as Array<[{ action: string }, { tx?: unknown }?]>).map(
    ([event, opts]) => [event.action, opts?.tx === ctx.tx],
  );
}

function auditEvent(ctx: Ctx, action: string): { details: Record<string, unknown> } & Record<string, unknown> {
  const call = ctx.audit.record.mock.calls.find((c) => (c[0] as { action: string }).action === action);
  if (!call) throw new Error(`no ${action} audit event`);
  return call[0] as { details: Record<string, unknown> } & Record<string, unknown>;
}

describe('FederatedBindingService', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('bind', () => {
    it('binds through a pending invitation of the connection organization, in the binding transaction', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const binding = await ctx.service.bind(
        ctx.tx as never, connection() as never, CLAIMS, 'new@acme.example', `cognito:${PROVIDER}`, true,
      );

      expect(binding).toEqual({ kind: 'invitation', userId: 'user_new', invitationId: 'inv_1', templateKey: 'employee' });
      expect(ctx.invitations.findPendingByEmailAndOrg).toHaveBeenCalledWith('new@acme.example', 'org_sample', expect.any(Date), ctx.tx);
      expect(ctx.identities.createExternalIdentity).toHaveBeenCalledWith(
        {
          userId: 'user_new',
          provider: `cognito:${PROVIDER}`,
          subject: 'idp-subject-1',
          cognitoUsername: `${PROVIDER}_idp-subject-1`,
          email: 'new@acme.example',
          emailVerified: true,
          ssoConnectionId: 'conn_1',
          lastSeenAt: expect.any(Date),
        },
        ctx.tx,
      );
      expect(ctx.invitations.accept).toHaveBeenCalledWith('inv_1', expect.any(Date), 'user_new', ctx.tx);
      expect(auditTransactions(ctx)).toEqual([
        ['user.created', true],
        ['identity.linked', true],
        ['membership.activated', true],
      ]);
      expect(auditEvent(ctx, 'identity.linked').details).toEqual({
        emailNormalised: 'new@acme.example',
        provider: `cognito:${PROVIDER}`,
        via: 'sso_invitation',
        connectionId: 'conn_1',
      });
    });

    it('reuses the user that already has the address', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identities.findUserByEmail.mockResolvedValue({ id: 'user_existing' });
      const binding = await ctx.service.bind(
        ctx.tx as never, connection() as never, CLAIMS, 'new@acme.example', `cognito:${PROVIDER}`, true,
      );
      expect(binding).toMatchObject({ kind: 'invitation', userId: 'user_existing' });
      expect(ctx.identities.createUser).not.toHaveBeenCalled();
    });

    it('provisions JIT on an ACTIVE connection with JIT on and a verified domain', async () => {
      const ctx = setup();
      const binding = await ctx.service.bind(
        ctx.tx as never, connection({ jitProvisioning: true }) as never, CLAIMS, 'new@acme.example', `cognito:${PROVIDER}`, true,
      );
      expect(binding).toEqual({ kind: 'jit', userId: 'user_new' });
      expect(ctx.authz.createGrant).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'employee', scopeOrgId: 'org_sample' }),
        ctx.tx,
      );
      expect(auditTransactions(ctx)).toEqual([
        ['user.created', true],
        ['identity.created', true],
        ['identity.linked', true],
        ['membership.activated', true],
      ]);
      expect(auditEvent(ctx, 'identity.linked').details).toMatchObject({ via: 'sso_jit', connectionId: 'conn_1' });
    });

    it.each([
      ['a TESTING connection', connection({ status: 'TESTING', jitProvisioning: true }), true],
      ['an unverified domain', connection({ jitProvisioning: true }), false],
      ['JIT off', connection(), true],
    ])('binds nothing without an invitation on %s', async (_label, conn, domainVerified) => {
      const ctx = setup();
      const binding = await ctx.service.bind(
        ctx.tx as never, conn as never, CLAIMS, 'new@acme.example', `cognito:${PROVIDER}`, domainVerified,
      );
      expect(binding).toBeNull();
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it.each([
      ['of another organization (Review Focus 2)', invitation({ orgId: 'org_other' })],
      ['for another address', invitation({ email: 'other@acme.example' })],
    ])('does not bind through an invitation %s', async (_label, inv) => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(inv);
      const binding = await ctx.service.bind(
        ctx.tx as never, connection() as never, CLAIMS, 'new@acme.example', `cognito:${PROVIDER}`, true,
      );
      expect(binding).toBeNull();
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
    });
  });

  describe('denyBinding (SSO-R-10)', () => {
    it('deletes the orphan pool user and records identity.denied for the connection organization', async () => {
      const ctx = setup();
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser').mockResolvedValue();
      await ctx.service.denyBinding(
        { ...CLAIMS, emailVerified: null }, 'new@acme.example', connection() as never, META, 'no_invitation',
      );
      expect(deleteUser).toHaveBeenCalledWith(`${PROVIDER}_idp-subject-1`);
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      expect(ctx.audit.record).toHaveBeenCalledWith({
        action: 'identity.denied',
        actorUserId: null,
        actorKind: 'SYSTEM',
        orgId: 'org_sample',
        recordType: 'external_identity',
        recordId: PROVIDER,
        result: 'DENIED',
        ip: META.ip,
        userAgent: META.userAgent,
        details: { emailNormalised: 'new@acme.example', reason: 'no_invitation', connectionId: 'conn_1', emailVerifiedClaim: null },
      });
    });

    it('still records the denial when the pool user cannot be deleted, and logs no address', async () => {
      const ctx = setup();
      vi.spyOn(ctx.idp, 'deleteUser').mockRejectedValue(new IdentityProviderError('gone', 'user_not_found'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      await ctx.service.denyBinding(CLAIMS, 'new@acme.example', null, META, 'connection_inactive');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'identity.denied',
          orgId: null,
          recordId: 'unknown',
          details: expect.objectContaining({ reason: 'connection_inactive', connectionId: null }),
        }),
      );
      expect(warn).toHaveBeenCalledWith('Could not delete the orphan federated user (user_not_found)');
    });
  });

  describe('checks', () => {
    it.each([
      ['a verified domain of this connection', { connectionId: 'conn_1', verifiedAt: new Date() }, true],
      ['a domain of another connection', { connectionId: 'conn_other', verifiedAt: new Date() }, false],
      ['a domain not verified yet', { connectionId: 'conn_1', verifiedAt: null }, false],
      ['an unknown domain', null, false],
    ])('isDomainVerifiedFor: %s', async (_label, row, expected) => {
      const ctx = setup();
      ctx.sso.findDomainByName.mockResolvedValue(row as never);
      expect(await ctx.service.isDomainVerifiedFor(connection() as never, 'acme.example')).toBe(expected);
    });
  });

  describe('existingIdentityUsable (path 1)', () => {
    const bound = (ssoConnectionId: string | null = 'conn_1') => ({ userId: 'user_known', ssoConnectionId });

    it.each([
      ['an ACTIVE member of the connection organization', [{ orgId: 'org_sample', status: 'ACTIVE' }], true],
      ['an INVITED member', [{ orgId: 'org_sample', status: 'INVITED' }], false],
      ['an ENDED member', [{ orgId: 'org_sample', status: 'ENDED' }], false],
      ['an ACTIVE member elsewhere only', [{ orgId: 'org_other', status: 'ACTIVE' }], false],
    ])('an identity bound through the connection, for %s', async (_label, rows, expected) => {
      const ctx = setup();
      ctx.memberships.findByUserId.mockResolvedValue(rows);
      expect(await ctx.service.existingIdentityUsable(bound(), connection() as never)).toBe(expected);
      expect(ctx.memberships.findByUserId).toHaveBeenCalledWith('user_known');
    });

    it.each([
      ['bound through another connection', bound('conn_other'), connection()],
      ['with no binding connection', bound(null), connection()],
      ['when no connection owns the provider name any more', bound(), null],
    ])('refuses an identity %s without reading memberships', async (_label, identity, conn) => {
      const ctx = setup();
      ctx.memberships.findByUserId.mockResolvedValue([{ orgId: 'org_sample', status: 'ACTIVE' }]);
      expect(await ctx.service.existingIdentityUsable(identity, conn as never)).toBe(false);
      expect(ctx.memberships.findByUserId).not.toHaveBeenCalled();
    });
  });
});

describe('sameEmail (SSO-R-09)', () => {
  it('compares lowercased and trimmed', () => {
    expect(sameEmail(' A@Acme.Example ', 'a@acme.example')).toBe(true);
    expect(sameEmail('a@acme.example', 'b@acme.example')).toBe(false);
  });
});

describe('domainOf', () => {
  it('is the part after the last @', () => {
    expect(domainOf('ana@acme.example')).toBe('acme.example');
    expect(domainOf('"a@b"@acme.example')).toBe('acme.example');
  });
});
