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
import {
  SsoConnectionCreateRequestSchema,
  SsoConnectionDomainRequestSchema,
  SsoConnectionListResponseSchema,
  SsoConnectionResponseSchema,
  SsoConnectionUpdateRequestSchema,
  SsoDomainResponseSchema,
  SsoTestResponseSchema,
} from './ops-admin.ts';

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

describe('SSO connection schemas (D-12, 5.4)', () => {
  const domain = {
    id: 'ssod_1',
    domain: 'acme.example',
    verifiedAt: null,
    txtRecordName: '_nestself-verify.acme.example',
    txtRecordValue: 'nestself-domain-verification=0123456789abcdef0123456789abcdef',
  };
  const connection = {
    id: 'sso_1',
    orgId: 'org_sample',
    protocol: 'SAML',
    cognitoProviderName: 'org-acme-saml',
    status: 'DRAFT',
    metadataUrl: 'https://idp.acme.example/metadata.xml',
    oidcIssuer: null,
    oidcClientId: null,
    idpInitiatedAllowed: false,
    jitProvisioning: false,
    defaultOrgUnitId: null,
    certificateExpiresAt: null,
    lastTestedAt: null,
    domains: [domain],
    spMetadata: {
      entityId: 'urn:amazon:cognito:sp:eu-central-1_example',
      acsUrl: 'https://nestself-dev.auth.eu-central-1.amazoncognito.com/saml2/idpresponse',
    },
  };

  it('SsoConnectionCreateRequestSchema accepts the strategy fields plus a slug and applies defaults', () => {
    const parsed = SsoConnectionCreateRequestSchema.parse({
      orgId: 'org_sample',
      slug: 'acme',
      protocol: 'SAML',
      metadataUrl: 'https://idp.acme.example/metadata.xml',
    });
    expect(parsed).toEqual({
      orgId: 'org_sample',
      slug: 'acme',
      protocol: 'SAML',
      metadataUrl: 'https://idp.acme.example/metadata.xml',
      idpInitiatedAllowed: false,
      jitProvisioning: false,
    });
  });

  it('SsoConnectionCreateRequestSchema accepts an OIDC connection with a mapping and default unit', () => {
    const parsed = SsoConnectionCreateRequestSchema.parse({
      orgId: 'org_sample',
      slug: 'acme-eu',
      protocol: 'OIDC',
      oidcIssuer: 'https://login.acme.example',
      oidcClientId: 'client-1',
      attributeMapping: { email: 'email' },
      jitProvisioning: true,
      defaultOrgUnitId: 'ou_sample',
    });
    expect(parsed.protocol).toBe('OIDC');
    expect(parsed.jitProvisioning).toBe(true);
  });

  it('SsoConnectionCreateRequestSchema enforces the slug pattern', () => {
    const base = { orgId: 'org_sample', protocol: 'SAML' };
    for (const slug of ['a', 'abcdefghijklm', 'Acme', 'acme_co', 'acme.co', '']) {
      expect(SsoConnectionCreateRequestSchema.safeParse({ ...base, slug }).success, slug).toBe(false);
    }
    for (const slug of ['ac', 'abcdefghijkl', 'acme-2']) {
      expect(SsoConnectionCreateRequestSchema.safeParse({ ...base, slug }).success, slug).toBe(true);
    }
    expect(SsoConnectionCreateRequestSchema.safeParse(base).success).toBe(false);
  });

  it('SsoConnectionCreateRequestSchema rejects an unknown protocol and a non-URL metadata URL', () => {
    const base = { orgId: 'org_sample', slug: 'acme' };
    expect(SsoConnectionCreateRequestSchema.safeParse({ ...base, protocol: 'WSFED' }).success).toBe(false);
    expect(
      SsoConnectionCreateRequestSchema.safeParse({ ...base, protocol: 'SAML', metadataUrl: 'not a url' }).success,
    ).toBe(false);
  });

  it('SsoConnectionCreateRequestSchema refuses IdP-initiated sign-in (SSO-R-12)', () => {
    const result = SsoConnectionCreateRequestSchema.safeParse({
      orgId: 'org_sample',
      slug: 'acme',
      protocol: 'SAML',
      idpInitiatedAllowed: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['idpInitiatedAllowed']);
  });

  it('SsoConnectionUpdateRequestSchema accepts a status change and metadata fields', () => {
    expect(SsoConnectionUpdateRequestSchema.parse({ status: 'SUSPENDED' })).toEqual({ status: 'SUSPENDED' });
    expect(SsoConnectionUpdateRequestSchema.parse({ status: 'ACTIVE' }).status).toBe('ACTIVE');
    expect(SsoConnectionUpdateRequestSchema.parse({ status: 'DRAFT' }).status).toBe('DRAFT');
    const patch = {
      metadataUrl: 'https://idp.acme.example/v2/metadata.xml',
      metadataXml: '<EntityDescriptor/>',
      oidcIssuer: 'https://login.acme.example',
      oidcClientId: 'client-2',
      attributeMapping: { email: 'mail' },
      jitProvisioning: true,
      defaultOrgUnitId: null,
      idpInitiatedAllowed: false,
    };
    expect(SsoConnectionUpdateRequestSchema.parse(patch)).toEqual(patch);
  });

  it('SsoConnectionUpdateRequestSchema refuses TESTING (only POST :id/test sets it) and unknown statuses', () => {
    expect(SsoConnectionUpdateRequestSchema.safeParse({ status: 'TESTING' }).success).toBe(false);
    expect(SsoConnectionUpdateRequestSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });

  it('SsoConnectionUpdateRequestSchema refuses idpInitiatedAllowed: true and an empty patch', () => {
    const result = SsoConnectionUpdateRequestSchema.safeParse({ idpInitiatedAllowed: true });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['idpInitiatedAllowed']);
    expect(SsoConnectionUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('SsoConnectionDomainRequestSchema lowercases and trims, and rejects a non-domain', () => {
    expect(SsoConnectionDomainRequestSchema.parse({ domain: '  Acme.EXAMPLE ' })).toEqual({ domain: 'acme.example' });
    for (const bad of ['', '   ', 'acme', 'user@acme.example', 'https://acme.example', 'acme..example', '-acme.example']) {
      expect(SsoConnectionDomainRequestSchema.safeParse({ domain: bad }).success, bad).toBe(false);
    }
  });

  it('SsoDomainResponseSchema accepts pending and verified domains', () => {
    expect(SsoDomainResponseSchema.parse(domain)).toEqual(domain);
    const verified = { ...domain, verifiedAt: '2026-10-25T10:00:00.000Z' };
    expect(SsoDomainResponseSchema.parse(verified)).toEqual(verified);
    expect(SsoDomainResponseSchema.safeParse({ ...domain, txtRecordValue: undefined }).success).toBe(false);
  });

  it('SsoDomainResponseSchema never carries the raw verification token column', () => {
    expect(SsoDomainResponseSchema.parse({ ...domain, verificationToken: 'secret' })).not.toHaveProperty('verificationToken');
  });

  it('SsoConnectionResponseSchema accepts the strategy shape plus domains and SP metadata', () => {
    expect(SsoConnectionResponseSchema.parse(connection)).toEqual(connection);
    expect(SsoConnectionResponseSchema.parse({ ...connection, spMetadata: null, domains: [] }).spMetadata).toBeNull();
    expect(SsoConnectionResponseSchema.safeParse({ ...connection, status: 'DELETED' }).success).toBe(false);
    expect(SsoConnectionResponseSchema.safeParse({ ...connection, domains: undefined }).success).toBe(false);
  });

  it('SsoConnectionResponseSchema strips stored secrets and raw metadata', () => {
    const parsed = SsoConnectionResponseSchema.parse({ ...connection, metadataXml: '<x/>', oidcClientSecret: 's' });
    expect(parsed).not.toHaveProperty('metadataXml');
    expect(parsed).not.toHaveProperty('oidcClientSecret');
  });

  it('SsoConnectionListResponseSchema wraps connections in items', () => {
    expect(SsoConnectionListResponseSchema.parse({ items: [connection] }).items).toHaveLength(1);
    expect(SsoConnectionListResponseSchema.safeParse({}).success).toBe(false);
  });

  it('SsoTestResponseSchema requires an absolute start URL', () => {
    const startUrl = 'http://localhost:4000/api/auth/sso/start?connection=org-acme-saml&surface=workspace&test=1';
    expect(SsoTestResponseSchema.parse({ startUrl })).toEqual({ startUrl });
    expect(SsoTestResponseSchema.safeParse({ startUrl: '/api/auth/sso/start' }).success).toBe(false);
  });

  it('AUTH_ERROR_CODES includes the SSO codes', () => {
    for (const code of ['sso_connection_state', 'domain_blocklisted', 'domain_unverified', 'sso_email_unverified']) {
      expect(AUTH_ERROR_CODES).toContain(code);
    }
  });
});
