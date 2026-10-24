import { describe, expect, it } from 'vitest';
import {
  OrgRoleSchema,
  SessionSchema,
  canAccessHr,
  canManageTeam,
} from './roles.ts';
import { LocaleSchema, defaultLocale, locales } from './locale.ts';
import { SupportAreaSchema, supportAreaIcon, supportAreas } from './support.ts';
import { HealthResponseSchema } from './health.ts';
import { accessModel } from './access-model.ts';
import {
  ApprovalAuthorityListResponseSchema,
  GrantListResponseSchema,
  GrantRevokeRequestSchema,
  OwnershipTransferRequestSchema,
  OwnershipTransferResponseSchema,
} from './org-admin.ts';
import { AUTH_ERROR_CODES } from './auth.ts';

describe('roles', () => {
  it('parses a valid OrgRole', () => {
    expect(OrgRoleSchema.parse('hr_admin')).toBe('hr_admin');
    expect(OrgRoleSchema.parse('employee')).toBe('employee');
    expect(OrgRoleSchema.parse('manager')).toBe('manager');
  });

  it('rejects an invalid OrgRole', () => {
    expect(() => OrgRoleSchema.parse('owner')).toThrow();
  });

  it('SessionSchema defaults locale to en', () => {
    const session = SessionSchema.parse({
      userId: 'u1',
      displayName: 'Test User',
      initials: 'TU',
      orgId: null,
      orgRole: null,
      platformRole: null,
    });
    expect(session.locale).toBe('en');
  });

  it('SessionSchema accepts a complete session', () => {
    const session = SessionSchema.parse({
      userId: 'u1',
      displayName: 'Test User',
      initials: 'TU',
      orgId: 'org1',
      orgRole: 'manager',
      platformRole: 'expert',
      locale: 'sr-Latn',
    });
    expect(session.orgRole).toBe('manager');
    expect(session.locale).toBe('sr-Latn');
  });

  it('canAccessHr returns true only for hr_admin', () => {
    expect(canAccessHr({ orgRole: 'hr_admin' })).toBe(true);
    expect(canAccessHr({ orgRole: 'manager' })).toBe(false);
    expect(canAccessHr({ orgRole: 'employee' })).toBe(false);
    expect(canAccessHr({ orgRole: null })).toBe(false);
  });

  it('canManageTeam returns true for manager and hr_admin', () => {
    expect(canManageTeam({ orgRole: 'manager' })).toBe(true);
    expect(canManageTeam({ orgRole: 'hr_admin' })).toBe(true);
    expect(canManageTeam({ orgRole: 'employee' })).toBe(false);
    expect(canManageTeam({ orgRole: null })).toBe(false);
  });
});

describe('locale', () => {
  it('has four locales including hu', () => {
    expect(locales).toEqual(['en', 'sr-Latn', 'sr-Cyrl', 'hu']);
  });

  it('defaults to en', () => {
    expect(defaultLocale).toBe('en');
  });

  it('parses valid locales', () => {
    expect(LocaleSchema.parse('en')).toBe('en');
    expect(LocaleSchema.parse('sr-Latn')).toBe('sr-Latn');
    expect(LocaleSchema.parse('sr-Cyrl')).toBe('sr-Cyrl');
    expect(LocaleSchema.parse('hu')).toBe('hu');
  });

  it('rejects invalid locales', () => {
    expect(() => LocaleSchema.parse('fr')).toThrow();
  });
});

describe('support', () => {
  it('has three support areas', () => {
    expect(supportAreas).toEqual(['psychological', 'legal', 'financial']);
  });

  it('parses valid support area', () => {
    expect(SupportAreaSchema.parse('psychological')).toBe('psychological');
  });

  it('maps support areas to icon tokens', () => {
    expect(supportAreaIcon.psychological).toBe('mentalSupport');
    expect(supportAreaIcon.legal).toBe('legal');
    expect(supportAreaIcon.financial).toBe('financial');
  });
});

describe('health', () => {
  it('accepts a valid health response with info and details', () => {
    const result = HealthResponseSchema.parse({
      status: 'ok',
      info: { database: { status: 'up' } },
      details: {},
    });
    expect(result.status).toBe('ok');
    expect(result.info).toEqual({ database: { status: 'up' } });
    expect(result.details).toEqual({});
  });

  it('accepts a minimal health response', () => {
    const result = HealthResponseSchema.parse({ status: 'ok' });
    expect(result.status).toBe('ok');
  });

  it('accepts error status with error info', () => {
    const result = HealthResponseSchema.parse({
      status: 'error',
      error: { database: { status: 'down', message: 'Connection refused' } },
    });
    expect(result.status).toBe('error');
  });

  it('rejects unknown status', () => {
    expect(() => HealthResponseSchema.parse({ status: 'unknown' })).toThrow();
  });
});

describe('access-model', () => {
  it('has a note and rows', () => {
    expect(accessModel.note).toBeDefined();
    expect(accessModel.rows).toHaveLength(5);
  });

  it('first row is Conversation content', () => {
    expect(accessModel.rows[0]?.data).toBe('Conversation content');
  });
});

describe('grant administration', () => {
  const grant = {
    id: 'grant_1',
    subjectUserId: 'user_ana',
    templateKey: 'team_manager',
    actions: ['budget.read'],
    scopeType: 'org_unit',
    scopeOrgId: 'org_sample',
    scopeOrgUnitId: 'team_product',
    includeDescendants: false,
    conditions: [{ type: 'spending_ceiling', amountMinor: 1000, currency: 'EUR' }],
    validFrom: '2026-10-24T00:00:00.000Z',
    validUntil: null,
    parentGrantId: null,
    grantedByUserId: 'user_ivana',
    grantedAt: '2026-10-24T00:00:00.000Z',
    revokedAt: null,
  };

  it('GrantRevokeRequestSchema accepts a reason of 3 to 500 characters', () => {
    expect(GrantRevokeRequestSchema.parse({ reason: 'role' })).toEqual({ reason: 'role' });
    expect(GrantRevokeRequestSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true);
  });

  it('GrantRevokeRequestSchema rejects a missing, short or long reason', () => {
    expect(GrantRevokeRequestSchema.safeParse({}).success).toBe(false);
    expect(GrantRevokeRequestSchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(GrantRevokeRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('GrantListResponseSchema wraps grant responses in items', () => {
    expect(GrantListResponseSchema.parse({ items: [grant] }).items).toHaveLength(1);
    expect(GrantListResponseSchema.parse({ items: [] }).items).toEqual([]);
    expect(GrantListResponseSchema.safeParse({ items: [{ ...grant, id: '' }] }).success).toBe(false);
    expect(GrantListResponseSchema.safeParse({}).success).toBe(false);
  });

  it('OwnershipTransferRequestSchema requires a non-empty newOwnerUserId', () => {
    expect(OwnershipTransferRequestSchema.parse({ newOwnerUserId: 'user_stefan' })).toEqual({
      newOwnerUserId: 'user_stefan',
    });
    expect(OwnershipTransferRequestSchema.safeParse({}).success).toBe(false);
    expect(OwnershipTransferRequestSchema.safeParse({ newOwnerUserId: '' }).success).toBe(false);
  });

  it('OwnershipTransferResponseSchema carries the revoked grant id and the created grant', () => {
    const parsed = OwnershipTransferResponseSchema.parse({
      revokedGrantId: 'grant_old',
      createdGrant: { ...grant, templateKey: 'employer_owner' },
    });
    expect(parsed.revokedGrantId).toBe('grant_old');
    expect(parsed.createdGrant.templateKey).toBe('employer_owner');
    expect(OwnershipTransferResponseSchema.safeParse({ createdGrant: grant }).success).toBe(false);
    expect(OwnershipTransferResponseSchema.safeParse({ revokedGrantId: 'g' }).success).toBe(false);
  });

  it('OwnershipTransferResponseSchema accepts a null revokedGrantId (staff path, no previous owner)', () => {
    expect(OwnershipTransferResponseSchema.safeParse({ revokedGrantId: null, createdGrant: grant }).success).toBe(true);
  });

  it('AUTH_ERROR_CODES includes the grant administration codes', () => {
    expect(AUTH_ERROR_CODES).toContain('owner_exists');
    expect(AUTH_ERROR_CODES).toContain('subject_not_member');
    expect(AUTH_ERROR_CODES).toContain('template_inactive');
    expect(AUTH_ERROR_CODES).toContain('missing_conditions');
  });
});

describe('approval authority schemas', () => {
  const authority = {
    id: 'aa_1',
    userId: 'user_stefan',
    orgId: 'org_sample',
    orgUnitId: null,
    includeDescendants: false,
    categories: ['events'],
    maxAmountMinor: 50_000,
    currency: 'EUR',
    validFrom: '2026-10-24T00:00:00.000Z',
    validUntil: null,
    delegatedFromId: null,
    alternateUserId: null,
    isConfidentialApprover: false,
  };

  it('ApprovalAuthorityListResponseSchema wraps authority responses in items', () => {
    expect(ApprovalAuthorityListResponseSchema.parse({ items: [authority] }).items).toEqual([authority]);
    expect(ApprovalAuthorityListResponseSchema.parse({ items: [] }).items).toEqual([]);
    expect(ApprovalAuthorityListResponseSchema.safeParse({ items: [{ ...authority, userId: '' }] }).success).toBe(false);
    expect(ApprovalAuthorityListResponseSchema.safeParse({}).success).toBe(false);
  });
});
