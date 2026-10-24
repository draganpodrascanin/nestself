import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvitationActivationService } from './invitation-activation.service.js';
import { hashToken } from './invitation-token.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-22T12:00:00Z');
const FUTURE = new Date('2026-10-30T00:00:00Z');
const PAST = new Date('2026-10-01T00:00:00Z');

function validInvitation(overrides: Record<string, unknown> = {}) {
  const token = 'a'.repeat(64);
  return {
    id: 'inv_1',
    email: 'invitee@example.com',
    orgId: 'org_sample',
    orgUnitId: null,
    templateKey: 'employee',
    tokenHash: hashToken(token),
    expiresAt: FUTURE,
    revokedAt: null,
    acceptedAt: null,
    invitedByUserId: 'user_ivana',
    importBatchId: null,
    createdAt: new Date('2026-10-20'),
    ...overrides,
  };
}

function createMockDbs() {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ name: 'Sample Org' }]),
        }),
      }),
    },
    withOrgScope: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'membership_1' }]),
          }),
        }),
      };
      return fn(tx);
    }),
  };
}

function createMockInvitations() {
  return {
    findPendingByTokenHash: vi.fn(),
    findByTokenHash: vi.fn(),
    accept: vi.fn().mockResolvedValue(undefined),
    hasSsoForEmailDomain: vi.fn().mockResolvedValue(false),
  };
}

function createMockIdentities() {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ id: 'user_new' }),
    upsertExternalIdentity: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockMemberships() {
  return {
    findByUserId: vi.fn().mockResolvedValue([]),
  };
}

function createMockAuthz() {
  return {
    createGrant: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAudit() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockIdp() {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ username: 'cognito_user', sub: 'sub_abc' }),
    startEmailOtp: vi.fn().mockResolvedValue({ username: 'cognito_user', session: 'sess_1' }),
    startPassword: vi.fn().mockResolvedValue({
      kind: 'challenge',
      challenge: 'NEW_PASSWORD_REQUIRED',
      session: 'sess_2',
      username: 'cognito_user',
    }),
  };
}

function createMockSignIn() {
  return {
    emailOtpStart: vi.fn().mockResolvedValue({
      challengeToken: 'challenge_token_otp',
      codeDeliveryMedium: 'EMAIL',
    }),
    passwordSignIn: vi.fn().mockResolvedValue({
      step: 'new_password' as const,
      challengeToken: 'challenge_token_pw',
    }),
  };
}

function createMockPrincipalLoader() {
  return {
    invalidateUser: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildService(overrides: Record<string, unknown> = {}) {
  const dbs = createMockDbs();
  const invitations = createMockInvitations();
  const identities = createMockIdentities();
  const membershipRepo = createMockMemberships();
  const authzRepo = createMockAuthz();
  const audit = createMockAudit();
  const idp = createMockIdp();
  const signIn = createMockSignIn();
  const principalLoader = createMockPrincipalLoader();

  const deps = {
    dbs,
    invitations,
    identities,
    membershipRepo,
    authzRepo,
    audit,
    idp,
    signIn,
    principalLoader,
    ...overrides,
  };

  const service = new InvitationActivationService(
    deps.dbs as never,
    deps.invitations as never,
    deps.identities as never,
    deps.membershipRepo as never,
    deps.authzRepo as never,
    deps.audit as never,
    deps.idp as never,
    deps.signIn as never,
    deps.principalLoader as never,
  );

  return { service, ...deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InvitationActivationService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  // -- preview --------------------------------------------------------------

  describe('preview()', () => {
    it('returns only the organization name (API-R-09)', async () => {
      const token = 'a'.repeat(64);
      const inv = validInvitation();
      const { service, invitations } = buildService();
      invitations.findPendingByTokenHash.mockResolvedValue(inv);

      const result = await service.preview(token);

      expect(result).toEqual({ organizationName: 'Sample Org' });
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('templateKey');
      expect(result).not.toHaveProperty('tokenHash');
    });

    it('returns 404 for a missing/expired token', async () => {
      const { service, invitations } = buildService();
      invitations.findPendingByTokenHash.mockResolvedValue(null);

      await expect(service.preview('unknown_token')).rejects.toThrow(
        expect.objectContaining({ code: 'not_found' }),
      );
    });

    it('returns 404 when the token hash does not match (constant-time safe)', async () => {
      const inv = validInvitation({ tokenHash: 'mismatched_hash' });
      const { service, invitations } = buildService();
      invitations.findPendingByTokenHash.mockResolvedValue(inv);

      await expect(service.preview('some_token')).rejects.toThrow(
        expect.objectContaining({ code: 'not_found' }),
      );
    });
  });

  // -- accept ---------------------------------------------------------------

  describe('accept()', () => {
    const token = 'a'.repeat(64);
    const surface = 'workspace' as const;
    const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

    it('creates user, membership, grants and returns email_otp for employee', async () => {
      const inv = validInvitation();
      const { service, invitations, identities, audit, signIn, principalLoader } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);

      const result = await service.accept(token, surface, meta);

      expect(result).toHaveProperty('method', 'email_otp');
      expect(result).toHaveProperty('challengeToken', 'challenge_token_otp');
      expect(identities.createUser).toHaveBeenCalled();
      expect(signIn.emailOtpStart).toHaveBeenCalledWith(
        'invitee@example.com',
        expect.any(Object),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invitation.accepted' }),
      );
      expect(principalLoader.invalidateUser).toHaveBeenCalled();
    });

    it('returns password/new_password challenge for an employer admin template', async () => {
      const inv = validInvitation({ templateKey: 'hr_admin' });
      const { service, invitations, signIn } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);

      const result = await service.accept(token, surface, meta);

      expect(result).toHaveProperty('method', 'password');
      expect(result).toHaveProperty('step', 'new_password');
      expect(result).toHaveProperty('challengeToken', 'challenge_token_pw');
      expect(signIn.passwordSignIn).toHaveBeenCalledWith(
        'invitee@example.com',
        expect.any(String), // temporary password
        'workspace',
        expect.any(Object),
      );
    });

    it.each(['platform_owner', 'client_operations', 'expert'])(
      'refuses a stored invitation with the non-organization template %s and creates nothing',
      async (templateKey) => {
        const inv = validInvitation({ templateKey });
        const { service, invitations, identities, authzRepo } = buildService();
        invitations.findByTokenHash.mockResolvedValue(inv);

        await expect(service.accept(token, surface, meta)).rejects.toThrow(
          expect.objectContaining({ code: 'invalid_invitation' }),
        );
        expect(identities.createUser).not.toHaveBeenCalled();
        expect(authzRepo.createGrant).not.toHaveBeenCalled();
      },
    );

    it('creates an organization-scoped default grant for an organization template', async () => {
      const inv = validInvitation({ templateKey: 'hr_admin' });
      const { service, invitations, authzRepo } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);

      await service.accept(token, surface, meta);

      expect(authzRepo.createGrant).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'hr_admin', scopeType: 'organization', scopeOrgId: 'org_sample' }),
        expect.anything(),
      );
    });

    it('rejects a revoked invitation with 401', async () => {
      const inv = validInvitation({ revokedAt: PAST });
      const { service, invitations } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);

      await expect(service.accept(token, surface, meta)).rejects.toThrow(
        expect.objectContaining({ code: 'invalid_invitation' }),
      );
    });

    it('rejects an expired invitation with 401', async () => {
      const inv = validInvitation({ expiresAt: PAST });
      const { service, invitations } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);

      await expect(service.accept(token, surface, meta)).rejects.toThrow(
        expect.objectContaining({ code: 'invalid_invitation' }),
      );
    });

    it('rejects a nonexistent token with 401', async () => {
      const { service, invitations } = buildService();
      invitations.findByTokenHash.mockResolvedValue(null);

      await expect(service.accept('no_such_token', surface, meta)).rejects.toThrow(
        expect.objectContaining({ code: 'invalid_invitation' }),
      );
    });

    it('is idempotent: already-accepted invitation returns a fresh challenge', async () => {
      const inv = validInvitation({ acceptedAt: PAST });
      const { service, invitations, identities, signIn } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);

      const result = await service.accept(token, surface, meta);

      // Should return a valid sign-in response without re-creating anything.
      expect(result).toHaveProperty('method', 'email_otp');
      expect(result).toHaveProperty('challengeToken');
      // No user creation or membership creation should happen.
      expect(identities.createUser).not.toHaveBeenCalled();
      expect(signIn.emailOtpStart).toHaveBeenCalled();
    });

    it('falls back to email OTP when password flow fails for an employer admin', async () => {
      const inv = validInvitation({ templateKey: 'hr_admin' });
      const { service, invitations, signIn } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);
      signIn.passwordSignIn.mockRejectedValue(new Error('IdP error'));

      const result = await service.accept(token, surface, meta);

      expect(result).toHaveProperty('method', 'email_otp');
      expect(result).toHaveProperty('challengeToken', 'challenge_token_otp');
    });

    it('audit details never contain the token or hash', async () => {
      const inv = validInvitation();
      const { service, invitations, audit } = buildService();
      invitations.findByTokenHash.mockResolvedValue(inv);

      await service.accept(token, surface, meta);

      for (const call of audit.record.mock.calls) {
        const details = JSON.stringify(call[0]?.details ?? {});
        expect(details).not.toContain(token);
        expect(details).not.toContain(inv.tokenHash);
      }
    });
  });
});
