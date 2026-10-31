import { Logger } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  INVITATION_IMPORT_ROW_REASONS,
  InvitationImportResponseSchema,
  type InvitationImportResponse,
} from '@nestself/contracts';
import { hashToken } from './invitation-token.js';
import { InvitationsService } from './invitations.service.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDbs() {
  return {
    db: {},
    withOrgScope: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
}

function createMockInvitations() {
  return {
    create: vi.fn().mockResolvedValue({
      id: 'inv_1',
      email: 'new@example.com',
      orgId: 'org_sample',
      orgUnitId: null,
      templateKey: 'employee',
      tokenHash: 'hash',
      expiresAt: new Date('2099-01-01'),
      revokedAt: null,
      acceptedAt: null,
      invitedByUserId: 'user_ivana',
      importBatchId: null,
      createdAt: new Date(),
    }),
    findPendingByEmailAndOrg: vi.fn().mockResolvedValue(null),
    findOrganizationName: vi.fn().mockResolvedValue('Example d.o.o.'),
    findByIdAndOrg: vi.fn(),
    revoke: vi.fn(),
    listPending: vi.fn().mockResolvedValue([]),
  };
}

function createMockMemberships() {
  return {
    findByUserId: vi.fn().mockResolvedValue([]),
  };
}

function createMockIdentities() {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserById: vi.fn().mockResolvedValue({ id: 'user_ivana', displayName: 'Ivana Jovanović' }),
  };
}

function createMockAudit() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAuthz() {
  return {
    findActiveOwnerGrants: vi.fn().mockResolvedValue([]),
  };
}

function createMockMailer() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

/** Every import row lands in exactly one bucket, so the three buckets add up to the rows sent. */
const rowsAccountedFor = (r: InvitationImportResponse): number => r.created + r.skipped + r.errors.length;

// The org unit lookup (`orgUnitInOrg`) runs `tx.select(...).from(...).where(...)`.
// The default transaction here is `{}`, so a test without an orgUnitId never
// reaches it; a test with one passes a transaction whose chain answers [] (the
// unit belongs to another organization) or [{ id }] (it belongs to this one).

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InvitationsService', () => {
  let dbs: ReturnType<typeof createMockDbs>;
  let invitations: ReturnType<typeof createMockInvitations>;
  let membershipRepo: ReturnType<typeof createMockMemberships>;
  let identities: ReturnType<typeof createMockIdentities>;
  let audit: ReturnType<typeof createMockAudit>;
  let mailer: ReturnType<typeof createMockMailer>;
  let authzRepo: ReturnType<typeof createMockAuthz>;
  let sso: { findActiveConnectionForDomain: ReturnType<typeof vi.fn> };
  let service: InvitationsService;

  beforeEach(() => {
    dbs = createMockDbs();
    invitations = createMockInvitations();
    membershipRepo = createMockMemberships();
    identities = createMockIdentities();
    audit = createMockAudit();
    mailer = createMockMailer();
    authzRepo = createMockAuthz();
    sso = { findActiveConnectionForDomain: vi.fn().mockResolvedValue(null) };

    service = new InvitationsService(
      dbs as never,
      invitations as never,
      membershipRepo as never,
      identities as never,
      audit as never,
      mailer as never,
      authzRepo as never,
      sso as never,
    );
  });

  type Mail = { email: string; token: string; organizationName: string; inviterDisplayName: string };
  const mailed = (): Mail[] => mailer.send.mock.calls.map(([input]) => input as Mail);

  // -- SSO domains of another organization ----------------------------------

  describe('SSO domain claimed by another organization', () => {
    const OTHER = { orgId: 'org_other', cognitoProviderName: 'org-other-saml' };

    it('create refuses with 409 conflict, details.reason sso_domain_claimed, before any write', async () => {
      sso.findActiveConnectionForDomain.mockResolvedValue(OTHER);
      const err = await service
        .create('org_sample', { email: 'person@other.example', templateKey: 'employee' }, 'user_ivana', false)
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'conflict', details: { reason: 'sso_domain_claimed' } });
      expect((err as { getStatus(): number }).getStatus()).toBe(409);
      expect(sso.findActiveConnectionForDomain).toHaveBeenCalledWith('other.example');
      expect(dbs.withOrgScope).not.toHaveBeenCalled();
      expect(invitations.create).not.toHaveBeenCalled();
    });

    it('create accepts a domain of the inviting organization\'s own connection', async () => {
      sso.findActiveConnectionForDomain.mockResolvedValue({ ...OTHER, orgId: 'org_sample' });
      await service.create('org_sample', { email: 'person@acme.example', templateKey: 'employee' }, 'user_ivana', false);
      expect(invitations.create).toHaveBeenCalledOnce();
    });

    it('import puts the claimed rows in errors and creates the rest', async () => {
      sso.findActiveConnectionForDomain.mockImplementation(async (d: string) => (d === 'other.example' ? OTHER : null));
      const result = await service.import(
        'org_sample',
        {
          invitations: [
            { email: 'ok@example.com', templateKey: 'employee' },
            { email: 'a@other.example', templateKey: 'employee' },
            { email: 'b@other.example', templateKey: 'employee' },
          ],
        },
        'user_ivana',
        false,
      );
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([
        { email: 'a@other.example', reason: 'sso_domain_claimed' },
        { email: 'b@other.example', reason: 'sso_domain_claimed' },
      ]);
      expect(rowsAccountedFor(result)).toBe(3);
      // One lookup per domain.
      expect(sso.findActiveConnectionForDomain).toHaveBeenCalledTimes(2);
    });
  });

  // -- create ---------------------------------------------------------------

  describe('create()', () => {
    it('creates an invitation and returns the response', async () => {
      const result = await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee' },
        'user_ivana',
        false,
      );

      expect(result).toHaveProperty('id', 'inv_1');
      expect(result).toHaveProperty('email', 'new@example.com');
      expect(invitations.create).toHaveBeenCalledOnce();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invitation.created' }),
      );
    });

    it('returns devToken in non-production mode', async () => {
      const result = await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee' },
        'user_ivana',
        false,
      );

      expect(result).toHaveProperty('devToken');
      expect(typeof result.devToken).toBe('string');
    });

    it('does not return devToken in production mode', async () => {
      const result = await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee' },
        'user_ivana',
        true,
      );

      expect(result).not.toHaveProperty('devToken');
    });

    it('rejects invalid template key with 400', async () => {
      await expect(
        service.create(
          'org_sample',
          { email: 'new@example.com', templateKey: 'nonexistent' },
          'user_ivana',
          false,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: 'validation' }));
    });

    it.each(['platform_owner', 'client_operations', 'nestself_finance', 'expert', 'expert_lead'])(
      'rejects the staff or platform template %s with 400 validation (details.templateKey)',
      async (templateKey) => {
        await expect(
          service.create('org_sample', { email: 'new@example.com', templateKey }, 'user_ivana', false),
        ).rejects.toThrow(
          expect.objectContaining({ code: 'validation', details: { templateKey } }),
        );
        expect(invitations.create).not.toHaveBeenCalled();
      },
    );

    it.each(['hr_admin', 'employer_owner', 'team_manager', 'employee'])(
      'accepts the organization template %s',
      async (templateKey) => {
        await service.create('org_sample', { email: 'new@example.com', templateKey }, 'user_ivana', false);
        expect(invitations.create).toHaveBeenCalledWith(
          expect.objectContaining({ templateKey }),
          expect.anything(),
        );
      },
    );

    it('rejects duplicate pending invitation with 409', async () => {
      invitations.findPendingByEmailAndOrg.mockResolvedValue({
        id: 'existing',
      });

      await expect(
        service.create(
          'org_sample',
          { email: 'existing@example.com', templateKey: 'employee' },
          'user_ivana',
          false,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: 'duplicate_invitation' }));
    });

    it('rejects when user is already an active member with 409', async () => {
      identities.findUserByEmail.mockResolvedValue({ id: 'user_existing' });
      membershipRepo.findByUserId.mockResolvedValue([
        { orgId: 'org_sample', status: 'ACTIVE' },
      ]);

      await expect(
        service.create(
          'org_sample',
          { email: 'member@example.com', templateKey: 'employee' },
          'user_ivana',
          false,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: 'already_member' }));
    });

    it('rejects an org unit of another organization with 400 before it writes anything', async () => {
      const noOrgUnits = { select: () => ({ from: () => ({ where: async () => [] }) }) };
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => fn(noOrgUnits));

      await expect(
        service.create(
          'org_sample',
          { email: 'new@example.com', templateKey: 'employee', orgUnitId: 'ou_elsewhere' },
          'user_ivana',
          false,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: 'validation' }));
      expect(invitations.create).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it('accepts an org unit of the organization', async () => {
      const oneOrgUnit = { select: () => ({ from: () => ({ where: async () => [{ id: 'ou_team' }] }) }) };
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => fn(oneOrgUnit));

      await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee', orgUnitId: 'ou_team' },
        'user_ivana',
        false,
      );

      expect(invitations.create).toHaveBeenCalledWith(
        expect.objectContaining({ orgUnitId: 'ou_team' }),
        oneOrgUnit,
      );
    });
  });

  // -- owner model (2026-10-24) -----------------------------------------------

  describe('employer_owner invitations', () => {
    const OWNER = { id: 'grant_user_ivana_employer_owner', subjectUserId: 'user_ivana' };

    it('create refuses employer_owner with 409 owner_exists while the organization has an owner', async () => {
      authzRepo.findActiveOwnerGrants.mockResolvedValue([OWNER]);
      await expect(
        service.create('org_sample', { email: 'owner2@example.com', templateKey: 'employer_owner' }, 'user_ivana', false),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'owner_exists', details: { currentOwnerUserId: 'user_ivana' } }),
      );
      expect(authzRepo.findActiveOwnerGrants).toHaveBeenCalledWith('org_sample', expect.any(Date), expect.anything());
      expect(invitations.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it('create does not look up owners for other templates', async () => {
      await service.create('org_sample', { email: 'new@example.com', templateKey: 'hr_admin' }, 'user_ivana', false);
      expect(authzRepo.findActiveOwnerGrants).not.toHaveBeenCalled();
    });

    it('import puts an employer_owner row in errors (owner_exists) and creates the other rows', async () => {
      authzRepo.findActiveOwnerGrants.mockResolvedValue([OWNER]);
      const result = await service.import(
        'org_sample',
        {
          invitations: [
            { email: 'ok@example.com', templateKey: 'employee' },
            { email: 'owner2@example.com', templateKey: 'employer_owner' },
          ],
        },
        'user_ivana',
        false,
      );
      expect(result.created).toBe(1);
      expect(result.errors).toEqual([{ email: 'owner2@example.com', reason: 'owner_exists' }]);
      expect(rowsAccountedFor(result)).toBe(2);
      expect(invitations.create).toHaveBeenCalledOnce();
      expect(invitations.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ok@example.com' }),
        expect.anything(),
      );
    });

    it('import accepts an employer_owner row when the organization has no owner', async () => {
      const result = await service.import(
        'org_sample',
        { invitations: [{ email: 'owner@example.com', templateKey: 'employer_owner' }] },
        'user_ivana',
        false,
      );
      expect(result.created).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });

  // -- import ---------------------------------------------------------------

  describe('import()', () => {
    it('reports a platform template row in errors and creates only the valid rows', async () => {
      const result = await service.import(
        'org_sample',
        {
          invitations: [
            { email: 'ok@example.com', templateKey: 'employee' },
            { email: 'owner@example.com', templateKey: 'platform_owner' },
            { email: 'ops@example.com', templateKey: 'client_operations' },
          ],
        },
        'user_ivana',
        false,
      );

      expect(result.created).toBe(1);
      expect(result.errors).toEqual([
        { email: 'owner@example.com', reason: 'invalid_template' },
        { email: 'ops@example.com', reason: 'invalid_template' },
      ]);
      expect(rowsAccountedFor(result)).toBe(3);
      expect(invitations.create).toHaveBeenCalledOnce();
      expect(invitations.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ok@example.com', templateKey: 'employee' }),
        expect.anything(),
      );
    });

    it('audits each created invitation inside the import transaction', async () => {
      const tx = { kind: 'org-tx' };
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => fn(tx));
      await service.import(
        'org_sample',
        { invitations: [{ email: 'a@example.com', templateKey: 'employee' }, { email: 'b@example.com', templateKey: 'employee' }] },
        'user_ivana',
        false,
      );

      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invitation.created', details: expect.objectContaining({ emailNormalised: 'a@example.com' }) }),
        { tx },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invitation.created', details: expect.objectContaining({ emailNormalised: 'b@example.com' }) }),
        { tx },
      );
    });

    // A transaction whose org unit lookup finds nothing: every unit belongs to another organization.
    const noOrgUnits = { select: () => ({ from: () => ({ where: async () => [] }) }) };
    const ACTIVE_OWNER = [{ id: 'grant_user_ivana_employer_owner', subjectUserId: 'user_ivana' }];

    it('a duplicate within the batch marks only the later row and creates the first', async () => {
      const result = await service.import(
        'org_sample',
        {
          invitations: [
            { email: 'twice@example.com', templateKey: 'employee' },
            { email: 'twice@example.com', templateKey: 'employee' },
          ],
        },
        'user_ivana',
        false,
      );

      expect(result).toEqual({
        created: 1,
        skipped: 0,
        errors: [{ email: 'twice@example.com', reason: 'duplicate_in_batch' }],
      });
      expect(invitations.create).toHaveBeenCalledOnce();
      expect(audit.record).toHaveBeenCalledOnce();
    });

    it('each row lands in exactly one bucket: a pending invitation or an active member is skipped, not an error', async () => {
      invitations.findPendingByEmailAndOrg.mockImplementation(async (email: string) =>
        email === 'pending@example.com' ? { id: 'inv_pending' } : null,
      );
      identities.findUserByEmail.mockImplementation(async (email: string) =>
        email === 'member@example.com' ? { id: 'user_member' } : null,
      );
      membershipRepo.findByUserId.mockResolvedValue([{ orgId: 'org_sample', status: 'ACTIVE' }]);

      const result = await service.import(
        'org_sample',
        {
          invitations: [
            { email: 'pending@example.com', templateKey: 'employee' },
            { email: 'member@example.com', templateKey: 'employee' },
          ],
        },
        'user_ivana',
        false,
      );

      expect(result).toEqual({ created: 0, skipped: 2, errors: [] });
      expect(invitations.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('a row that fails two checks is reported once, for the first check that fails', async () => {
      authzRepo.findActiveOwnerGrants.mockResolvedValue(ACTIVE_OWNER);
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => fn(noOrgUnits));

      const result = await service.import(
        'org_sample',
        { invitations: [{ email: 'both@example.com', templateKey: 'employer_owner', orgUnitId: 'ou_elsewhere' }] },
        'user_ivana',
        false,
      );

      expect(result).toEqual({
        created: 0,
        skipped: 0,
        errors: [{ email: 'both@example.com', reason: 'org_unit_outside_org' }],
      });
    });

    it('row reasons are codes of the contract, and the answer parses', async () => {
      authzRepo.findActiveOwnerGrants.mockResolvedValue(ACTIVE_OWNER);
      sso.findActiveConnectionForDomain.mockImplementation(async (d: string) =>
        d === 'other.example' ? { orgId: 'org_other', cognitoProviderName: 'org-other-saml' } : null,
      );
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => fn(noOrgUnits));

      const result = await service.import(
        'org_sample',
        {
          invitations: [
            { email: 'platform@example.com', templateKey: 'platform_owner' },
            { email: 'twice@example.com', templateKey: 'employee' },
            { email: 'twice@example.com', templateKey: 'employee' },
            { email: 'unit@example.com', templateKey: 'employee', orgUnitId: 'ou_elsewhere' },
            { email: 'claimed@other.example', templateKey: 'employee' },
            { email: 'second-owner@example.com', templateKey: 'employer_owner' },
          ],
        },
        'user_ivana',
        false,
      );

      expect(result.errors).toEqual([
        { email: 'platform@example.com', reason: 'invalid_template' },
        { email: 'twice@example.com', reason: 'duplicate_in_batch' },
        { email: 'unit@example.com', reason: 'org_unit_outside_org' },
        { email: 'claimed@other.example', reason: 'sso_domain_claimed' },
        { email: 'second-owner@example.com', reason: 'owner_exists' },
      ]);
      for (const { reason } of result.errors) expect(INVITATION_IMPORT_ROW_REASONS).toContain(reason);
      expect(InvitationImportResponseSchema.parse(result)).toEqual(result);
    });

    it('created, skipped and errors add up to the rows sent, errors in row order', async () => {
      authzRepo.findActiveOwnerGrants.mockResolvedValue(ACTIVE_OWNER);
      sso.findActiveConnectionForDomain.mockImplementation(async (d: string) =>
        d === 'other.example' ? { orgId: 'org_other', cognitoProviderName: 'org-other-saml' } : null,
      );
      invitations.findPendingByEmailAndOrg.mockImplementation(async (email: string) =>
        email === 'pending@example.com' ? { id: 'inv_pending' } : null,
      );
      identities.findUserByEmail.mockImplementation(async (email: string) =>
        email === 'member@example.com' ? { id: 'user_member' } : null,
      );
      membershipRepo.findByUserId.mockResolvedValue([{ orgId: 'org_sample', status: 'ACTIVE' }]);
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => fn(noOrgUnits));
      const rows = [
        { email: 'first@example.com', templateKey: 'employee' },
        { email: 'first@example.com', templateKey: 'employee' },
        { email: 'pending@example.com', templateKey: 'employee' },
        { email: 'member@example.com', templateKey: 'employee' },
        { email: 'platform@example.com', templateKey: 'platform_owner' },
        { email: 'unit@example.com', templateKey: 'employee', orgUnitId: 'ou_elsewhere' },
        { email: 'second-owner@example.com', templateKey: 'employer_owner' },
        { email: 'claimed@other.example', templateKey: 'employee' },
        { email: 'last@example.com', templateKey: 'employee' },
      ];

      const result = await service.import('org_sample', { invitations: rows }, 'user_ivana', false);

      expect(result).toEqual({
        created: 2,
        skipped: 2,
        errors: [
          { email: 'first@example.com', reason: 'duplicate_in_batch' },
          { email: 'platform@example.com', reason: 'invalid_template' },
          { email: 'unit@example.com', reason: 'org_unit_outside_org' },
          { email: 'second-owner@example.com', reason: 'owner_exists' },
          { email: 'claimed@other.example', reason: 'sso_domain_claimed' },
        ],
      });
      expect(rowsAccountedFor(result)).toBe(rows.length);
      // Only the created rows reach the repository, the audit trail and the mailer.
      expect(invitations.create.mock.calls.map(([input]) => input.email)).toEqual([
        'first@example.com',
        'last@example.com',
      ]);
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(mailed().map((m) => m.email)).toEqual(['first@example.com', 'last@example.com']);
    });
  });

  // -- emails are sent after the commit -----------------------------------------

  describe('invitation emails', () => {
    const CREATED_ROW = {
      id: 'inv_1',
      email: 'one@example.com',
      orgId: 'org_sample',
      orgUnitId: null,
      templateKey: 'employee',
      tokenHash: 'hash',
      expiresAt: new Date('2099-01-01'),
      revokedAt: null,
      acceptedAt: null,
      invitedByUserId: 'user_ivana',
      importBatchId: null,
      createdAt: new Date(),
    };
    const TWO_ROWS = {
      invitations: [
        { email: 'one@example.com', templateKey: 'employee' },
        { email: 'two@example.com', templateKey: 'employee' },
      ],
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('import sends the emails only after the transaction has resolved', async () => {
      const events: string[] = [];
      let sentBeforeCommit = -1;
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => {
        const result = await fn({});
        // The callback is done but the transaction has not committed yet.
        sentBeforeCommit = mailer.send.mock.calls.length;
        events.push('commit');
        return result;
      });
      mailer.send.mockImplementation(async () => {
        events.push('mail');
      });

      const result = await service.import('org_sample', TWO_ROWS, 'user_ivana', false);

      expect(result.created).toBe(2);
      expect(sentBeforeCommit).toBe(0);
      expect(events).toEqual(['commit', 'mail', 'mail']);
    });

    it('import mails each created invitation its own token, with the organization and inviter names', async () => {
      await service.import('org_sample', TWO_ROWS, 'user_ivana', false);

      expect(mailed()).toHaveLength(2);
      expect(mailed().map((m) => m.email)).toEqual(['one@example.com', 'two@example.com']);
      expect(mailed()[0]).toMatchObject({ organizationName: 'Example d.o.o.', inviterDisplayName: 'Ivana Jovanović' });
      expect(new Set(mailed().map((m) => m.token)).size).toBe(2);
      // The token in the email is the one whose hash was stored.
      mailed().forEach((m, i) => {
        expect(invitations.create).toHaveBeenNthCalledWith(
          i + 1,
          expect.objectContaining({ email: m.email, tokenHash: hashToken(m.token) }),
          expect.anything(),
        );
      });
    });

    it('import mails only the rows it created', async () => {
      invitations.findPendingByEmailAndOrg.mockImplementation(async (email: string) =>
        email === 'one@example.com' ? { id: 'existing' } : null,
      );

      const result = await service.import('org_sample', TWO_ROWS, 'user_ivana', false);

      expect(result).toEqual({ created: 1, skipped: 1, errors: [] });
      expect(mailed().map((m) => m.email)).toEqual(['two@example.com']);
    });

    it('import mails the first row of a repeated address, and not the later one', async () => {
      const result = await service.import(
        'org_sample',
        {
          invitations: [
            { email: 'twice@example.com', templateKey: 'employee' },
            { email: 'twice@example.com', templateKey: 'employee' },
            { email: 'once@example.com', templateKey: 'employee' },
          ],
        },
        'user_ivana',
        false,
      );

      expect(result).toEqual({
        created: 2,
        skipped: 0,
        errors: [{ email: 'twice@example.com', reason: 'duplicate_in_batch' }],
      });
      expect(mailed().map((m) => m.email)).toEqual(['twice@example.com', 'once@example.com']);
    });

    it('import sends nothing when the transaction fails after a row was created', async () => {
      invitations.create
        .mockResolvedValueOnce(CREATED_ROW)
        .mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.import('org_sample', TWO_ROWS, 'user_ivana', false)).rejects.toThrow('connection lost');

      expect(mailer.send).not.toHaveBeenCalled();
    });

    it('import still answers when an email cannot be sent, and logs the failure', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mailer.send.mockRejectedValue(new Error('MessageRejected'));

      const result = await service.import('org_sample', TWO_ROWS, 'user_ivana', false);

      expect(result).toMatchObject({ created: 2, skipped: 0, errors: [] });
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('MessageRejected'));
    });

    it('create sends the email only after the transaction has resolved', async () => {
      let sentBeforeCommit = -1;
      dbs.withOrgScope.mockImplementation(async (_orgId, fn) => {
        const result = await fn({});
        sentBeforeCommit = mailer.send.mock.calls.length;
        return result;
      });

      const result = await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee' },
        'user_ivana',
        false,
      );

      expect(sentBeforeCommit).toBe(0);
      expect(mailer.send).toHaveBeenCalledOnce();
      expect(mailed()[0]).toEqual({
        email: 'new@example.com',
        token: result['devToken'],
        organizationName: 'Example d.o.o.',
        inviterDisplayName: 'Ivana Jovanović',
      });
    });

    it('create sends nothing when the transaction fails', async () => {
      invitations.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.create('org_sample', { email: 'new@example.com', templateKey: 'employee' }, 'user_ivana', false),
      ).rejects.toThrow('connection lost');

      expect(mailer.send).not.toHaveBeenCalled();
    });
  });

  // -- revoke ---------------------------------------------------------------

  describe('revoke()', () => {
    it('revokes an invitation and returns the response', async () => {
      const inv = {
        id: 'inv_1',
        email: 'revoked@example.com',
        orgId: 'org_sample',
        orgUnitId: null,
        templateKey: 'employee',
        tokenHash: 'h',
        expiresAt: new Date('2099-01-01'),
        revokedAt: null,
        acceptedAt: null,
        invitedByUserId: 'user_ivana',
        importBatchId: null,
        createdAt: new Date(),
      };
      invitations.findByIdAndOrg.mockResolvedValue(inv);
      invitations.revoke.mockResolvedValue({ ...inv, revokedAt: new Date() });

      const result = await service.revoke('org_sample', 'inv_1', 'user_ivana');

      expect(result).toHaveProperty('id', 'inv_1');
      expect(result.revokedAt).not.toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invitation.revoked' }),
      );
    });

    it('is idempotent on an already revoked invitation (200)', async () => {
      const revokedAt = new Date('2026-10-01');
      const inv = {
        id: 'inv_1',
        email: 'revoked@example.com',
        orgId: 'org_sample',
        orgUnitId: null,
        templateKey: 'employee',
        tokenHash: 'h',
        expiresAt: new Date('2099-01-01'),
        revokedAt,
        acceptedAt: null,
        invitedByUserId: 'user_ivana',
        importBatchId: null,
        createdAt: new Date(),
      };
      invitations.findByIdAndOrg.mockResolvedValue(inv);

      const result = await service.revoke('org_sample', 'inv_1', 'user_ivana');

      expect(result).toHaveProperty('id', 'inv_1');
      // revoke() should not be called again since it's already revoked.
      expect(invitations.revoke).not.toHaveBeenCalled();
    });

    it('returns 404 when invitation is not in this org', async () => {
      invitations.findByIdAndOrg.mockResolvedValue(null);

      await expect(
        service.revoke('org_sample', 'inv_nonexistent', 'user_ivana'),
      ).rejects.toThrow(expect.objectContaining({ code: 'not_found' }));
    });
  });

  describe('listPending', () => {
    const pending = (id: string) => ({
      id,
      email: `${id}@example.com`,
      orgId: 'org_sample',
      orgUnitId: null,
      templateKey: 'employee',
      tokenHash: 'hash',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      revokedAt: null,
      acceptedAt: null,
      invitedByUserId: 'user_ivana',
      importBatchId: null,
      createdAt: new Date('2026-10-25T00:00:00.000Z'),
    });

    it('reads inside the organization scope and returns nextCursor when a further row exists', async () => {
      invitations.listPending.mockResolvedValue([pending('inv_3'), pending('inv_2'), pending('inv_1')]);

      const res = await service.listPending('org_sample', { limit: 2, cursor: 'inv_4', status: 'pending' });

      expect(dbs.withOrgScope).toHaveBeenCalledWith('org_sample', expect.any(Function));
      expect(invitations.listPending).toHaveBeenCalledWith(
        'org_sample',
        { limit: 2, cursor: 'inv_4', now: expect.any(Date) },
        {},
      );
      expect(res.items.map((i) => i.id)).toEqual(['inv_3', 'inv_2']);
      expect(res.nextCursor).toBe('inv_2');
    });

    it('never returns the token hash or a devToken, and ends with nextCursor null', async () => {
      invitations.listPending.mockResolvedValue([pending('inv_1')]);

      const res = await service.listPending('org_sample', { limit: 25, status: 'pending' });

      expect(res.nextCursor).toBeNull();
      expect(res.items[0]).toEqual({
        id: 'inv_1',
        email: 'inv_1@example.com',
        orgId: 'org_sample',
        orgUnitId: null,
        templateKey: 'employee',
        expiresAt: '2099-01-01T00:00:00.000Z',
        revokedAt: null,
        acceptedAt: null,
        invitedByUserId: 'user_ivana',
        createdAt: '2026-10-25T00:00:00.000Z',
      });
    });
  });
});
