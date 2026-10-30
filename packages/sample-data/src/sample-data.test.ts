import { describe, it, expect } from 'vitest';
import {
  ConversationResponseSchema,
  ConversationSummarySchema,
  EmergencyAccessResponseSchema,
  IntakeResponseSchema,
  InvitationResponseSchema,
  PERMISSION_TEMPLATES,
  SSO_SLUG_PATTERN,
  SsoConnectionResponseSchema,
} from '@nestself/contracts';
import {
  SAMPLE_ORG,
  SAMPLE_TEAMS,
  SAMPLE_PEOPLE,
  SAMPLE_EDITORIAL_STAFF,
  SAMPLE_CATEGORY_IDS,
  SAMPLE_EXTERNAL_IDENTITIES,
  SAMPLE_SESSIONS,
  SAMPLE_CHANNELS,
  SAMPLE_POSTS,
  SAMPLE_POLLS,
  SAMPLE_EXPERTS,
  SAMPLE_CONTENT,
  SAMPLE_BOOKING,
  SAMPLE_HR_PROGRAMME,
  SAMPLE_EVENT_REQUEST,
  SAMPLE_TESTIMONIALS,
  SAMPLE_ORG_UNITS,
  SAMPLE_EXPERT_CREDENTIALS,
  SAMPLE_CASE,
  SAMPLE_INVITATIONS,
  SAMPLE_EMERGENCY_ACCESS,
  SAMPLE_SSO_CONNECTIONS,
  SAMPLE_CONVERSATIONS,
  SAMPLE_PRINCIPALS,
  isSampleMode,
  assertNotProduction,
} from './index.ts';
const QUOTE_LOCALES = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const;

describe('sample-data fixtures', () => {
  const allFixtures: ReadonlyArray<object> = [
    SAMPLE_ORG,
    ...SAMPLE_TEAMS,
    ...SAMPLE_PEOPLE,
    ...SAMPLE_EDITORIAL_STAFF,
    ...SAMPLE_CHANNELS,
    ...SAMPLE_POSTS,
    ...SAMPLE_POLLS,
    ...SAMPLE_EXPERTS,
    ...SAMPLE_CONTENT,
    SAMPLE_BOOKING,
    SAMPLE_HR_PROGRAMME,
    SAMPLE_EVENT_REQUEST,
    ...SAMPLE_ORG_UNITS,
    ...SAMPLE_EXPERT_CREDENTIALS,
    SAMPLE_CASE,
    ...SAMPLE_INVITATIONS,
    ...SAMPLE_EMERGENCY_ACCESS,
    ...SAMPLE_SSO_CONNECTIONS,
    ...SAMPLE_CONVERSATIONS,
  ];

  it('every fixture has sample === true', () => {
    for (const obj of allFixtures) {
      expect(obj).toHaveProperty('sample', true);
    }
  });

  it('no fixture object has a portrait or photo value other than null', () => {
    for (const obj of allFixtures) {
      if ('portrait' in obj) {
        expect((obj as { portrait: unknown }).portrait).toBeNull();
      }
      if ('photo' in obj) {
        expect((obj as { photo: unknown }).photo).toBeNull();
      }
    }
  });

  it('has six stable launch category ids', () => {
    expect(Object.values(SAMPLE_CATEGORY_IDS)).toEqual([
      'cat_stress', 'cat_sleep', 'cat_relationships', 'cat_money', 'cat_work', 'cat_body',
    ]);
  });

  it('editorial staff have password identities and first names only', () => {
    for (const staff of SAMPLE_EDITORIAL_STAFF) {
      const identity = SAMPLE_EXTERNAL_IDENTITIES.find((i) => i.userId === staff.id);
      expect(identity?.signIn).toBe('password');
      expect(staff.displayName).not.toContain(' ');
    }
  });

  it('SAMPLE_SESSIONS.hr_admin.orgRole === "hr_admin"', () => {
    expect(SAMPLE_SESSIONS.hr_admin.orgRole).toBe('hr_admin');
  });

  it('SAMPLE_BOOKING.appointmentAt formatted in Europe/Belgrade reads 16:30', () => {
    const dt = new Date(SAMPLE_BOOKING.appointmentAt);
    const time = dt.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Belgrade',
    });
    expect(time).toBe('16:30');
  });

  it('sample posts are neutral team announcements without performance claims', () => {
    const banned = ['all-time high', 'closed a great', 'shipped on time', 'satisfaction scores'];
    for (const post of SAMPLE_POSTS) {
      for (const phrase of banned) {
        expect(post.content.toLowerCase()).not.toContain(phrase);
      }
    }
  });

  it('the sample case carries only labelled placeholder text', () => {
    const bodies = [...SAMPLE_CASE.conversation.messages.map((m) => m.body), SAMPLE_CASE.intake.body];
    for (const body of bodies) {
      expect(body).toMatch(/\(fixture\)$/);
    }
  });
});

describe('SAMPLE_TESTIMONIALS', () => {
  it('has exactly six entries', () => {
    expect(SAMPLE_TESTIMONIALS).toHaveLength(6);
  });

  it('every entry has placeholder: true', () => {
    for (const t of SAMPLE_TESTIMONIALS) {
      expect(t.placeholder).toBe(true);
    }
  });

  it('every entry has quotes for all four locales', () => {
    for (const t of SAMPLE_TESTIMONIALS) {
      for (const locale of QUOTE_LOCALES) {
        expect(t.quote[locale]).toBeDefined();
        expect(typeof t.quote[locale]).toBe('string');
        expect(t.quote[locale].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('SAMPLE_ORG_UNITS', () => {
  it('has exactly one COMPANY root', () => {
    const roots = SAMPLE_ORG_UNITS.filter((u) => u.kind === 'COMPANY');
    expect(roots).toHaveLength(1);
    expect(roots[0]!.parentId).toBeNull();
  });

  it('every non-root unit has a parentId in the set', () => {
    const ids = new Set(SAMPLE_ORG_UNITS.map((u) => u.id));
    for (const u of SAMPLE_ORG_UNITS) {
      if (u.parentId !== null) {
        expect(ids.has(u.parentId)).toBe(true);
      }
    }
  });

  it('TEAM org-unit ids match SAMPLE_TEAMS ids', () => {
    const teamUnitIds = SAMPLE_ORG_UNITS
      .filter((u) => u.kind === 'TEAM')
      .map((u) => u.id)
      .sort();
    const legacyTeamIds = [...SAMPLE_TEAMS].map((t) => t.id).sort();
    expect(teamUnitIds).toEqual(legacyTeamIds);
  });
});

describe('SAMPLE_INVITATIONS', () => {
  it('has two or three pending invitations in the sample organization', () => {
    expect(SAMPLE_INVITATIONS.length).toBeGreaterThanOrEqual(2);
    expect(SAMPLE_INVITATIONS.length).toBeLessThanOrEqual(3);
    for (const inv of SAMPLE_INVITATIONS) {
      expect(inv.orgId).toBe(SAMPLE_ORG.id);
      expect(inv.revokedAt).toBeNull();
      expect(inv.acceptedAt).toBeNull();
    }
  });

  it('parses as invitation responses on the reserved example.com domain', () => {
    for (const inv of SAMPLE_INVITATIONS) {
      const { sample: _sample, ...rest } = inv;
      expect(InvitationResponseSchema.parse(rest)).toEqual(rest);
      expect(inv.email.endsWith('@example.com')).toBe(true);
    }
  });

  it('uses only invitable templates and units of the sample tree', () => {
    const unitIds = new Set<string>(SAMPLE_ORG_UNITS.map((u) => u.id));
    for (const inv of SAMPLE_INVITATIONS) {
      const tpl = PERMISSION_TEMPLATES.find((t) => t.key === inv.templateKey);
      expect(tpl?.isActive).toBe(true);
      expect(['organization', 'employee']).toContain(tpl?.workspace);
      if (inv.orgUnitId !== null) expect(unitIds.has(inv.orgUnitId)).toBe(true);
    }
  });
});

describe('SAMPLE_SSO_CONNECTIONS', () => {
  it('has an active SAML connection with a verified domain and a draft OIDC one with a pending domain', () => {
    expect(SAMPLE_SSO_CONNECTIONS).toHaveLength(2);
    const [saml, oidc] = SAMPLE_SSO_CONNECTIONS;
    expect(saml?.protocol).toBe('SAML');
    expect(saml?.status).toBe('ACTIVE');
    expect(saml?.domains.every((d) => d.verifiedAt !== null)).toBe(true);
    expect(oidc?.protocol).toBe('OIDC');
    expect(oidc?.status).toBe('DRAFT');
    expect(oidc?.domains.every((d) => d.verifiedAt === null)).toBe(true);
  });

  it('parses as SSO connection responses of the sample organization, on reserved fictional domains', () => {
    for (const row of SAMPLE_SSO_CONNECTIONS) {
      const { sample: _sample, ...rest } = row;
      expect(SsoConnectionResponseSchema.parse(rest)).toEqual(rest);
      expect(row.orgId).toBe(SAMPLE_ORG.id);
      expect(row.idpInitiatedAllowed).toBe(false);
      const slug = row.cognitoProviderName.replace(/^org-/, '').replace(/-(saml|oidc)$/, '');
      expect(slug).toMatch(SSO_SLUG_PATTERN);
      for (const d of row.domains) {
        expect(d.domain).toMatch(/\.example$/);
        expect(d.txtRecordName).toBe(`_nestself-verify.${d.domain}`);
      }
    }
  });
});

describe('SAMPLE_EMERGENCY_ACCESS', () => {
  it('has two records: one pending request and one revoked window', () => {
    expect(SAMPLE_EMERGENCY_ACCESS).toHaveLength(2);
    const [pending, revoked] = SAMPLE_EMERGENCY_ACCESS;
    expect(pending?.approvedByUserId).toBeNull();
    expect(pending?.revokedAt).toBeNull();
    expect(revoked?.approvedByUserId).not.toBeNull();
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it('parses as emergency access responses within the API limits', () => {
    for (const row of SAMPLE_EMERGENCY_ACCESS) {
      const { sample: _sample, ...rest } = row;
      expect(EmergencyAccessResponseSchema.parse(rest)).toEqual(rest);
      expect(row.purpose.length).toBeGreaterThanOrEqual(10);
      expect(row.purpose).toMatch(/fixture/);
      expect(row.durationMinutes).toBeGreaterThanOrEqual(15);
      expect(row.durationMinutes).toBeLessThanOrEqual(240);
    }
  });

  it('uses sample principals and sample scopes, and nobody approves their own request', () => {
    const userIds = new Set(Object.values(SAMPLE_PRINCIPALS).map((p) => p.principal.userId));
    for (const row of SAMPLE_EMERGENCY_ACCESS) {
      expect(userIds.has(row.userId)).toBe(true);
      if (row.approvedByUserId !== null) {
        expect(userIds.has(row.approvedByUserId)).toBe(true);
        expect(row.approvedByUserId).not.toBe(row.userId);
      }
      const scope = row.scopeKind === 'CASE' ? SAMPLE_CASE.id : SAMPLE_CASE.employeeUserId;
      expect(row.scopeId).toBe(scope);
    }
  });
});

describe('SAMPLE_CONVERSATIONS', () => {
  it('parses as conversation summaries, conversations and intakes', () => {
    for (const row of SAMPLE_CONVERSATIONS) {
      const { messages, intake, sample: _sample, ...summary } = row;
      expect(ConversationSummarySchema.parse(summary)).toEqual(summary);
      const conversation = { id: row.id, caseId: row.caseId, orgId: row.orgId, messages };
      expect(ConversationResponseSchema.parse(conversation)).toEqual(conversation);
      if (intake) {
        expect(IntakeResponseSchema.parse(intake)).toEqual(intake);
        expect(intake.caseId).toBe(row.caseId);
      }
    }
  });

  it('counts its messages, keeps them oldest first and uses only bland fixture bodies', () => {
    for (const row of SAMPLE_CONVERSATIONS) {
      expect(row.messageCount).toBe(row.messages.length);
      const times = row.messages.map((m) => m.createdAt);
      expect([...times].sort()).toEqual(times);
      for (const m of row.messages) {
        expect(m.body).toMatch(/^Sample [a-z ]+ \(fixture\)$/);
        expect([row.employeeUserId, row.expertUserId]).toContain(m.authorUserId);
      }
      if (row.intake) expect(row.intake.body).toMatch(/\(fixture\)$/);
    }
  });

  it('mirrors the seeded sample case and uses sample people only', () => {
    const [seeded] = SAMPLE_CONVERSATIONS;
    expect(seeded?.id).toBe(SAMPLE_CASE.conversation.id);
    expect(seeded?.caseId).toBe(SAMPLE_CASE.id);
    expect(seeded?.intake?.id).toBe(SAMPLE_CASE.intake.id);
    const people = new Set<string>(SAMPLE_PEOPLE.map((p) => p.id));
    for (const row of SAMPLE_CONVERSATIONS) {
      expect(people.has(row.employeeUserId)).toBe(true);
      expect(people.has(row.expertUserId)).toBe(true);
    }
    expect(new Set(SAMPLE_CONVERSATIONS.map((c) => c.id)).size).toBe(SAMPLE_CONVERSATIONS.length);
  });
});

describe('SAMPLE_EXPERT_CREDENTIALS', () => {
  it('has one credential per sample expert', () => {
    expect(SAMPLE_EXPERT_CREDENTIALS).toHaveLength(SAMPLE_EXPERTS.length);
  });

  it('every credential has status APPROVED', () => {
    for (const ec of SAMPLE_EXPERT_CREDENTIALS) {
      expect(ec.status).toBe('APPROVED');
    }
  });
});

describe('sample-data mode helpers', () => {
  it('isSampleMode returns true when VITE_DATA_SOURCE is "sample"', () => {
    expect(isSampleMode({ VITE_DATA_SOURCE: 'sample' })).toBe(true);
  });

  it('isSampleMode returns true when EXPO_PUBLIC_DATA_SOURCE is "sample"', () => {
    expect(isSampleMode({ EXPO_PUBLIC_DATA_SOURCE: 'sample' })).toBe(true);
  });

  it('isSampleMode returns false for empty env', () => {
    expect(isSampleMode({})).toBe(false);
  });

  it('assertNotProduction throws when NODE_ENV is "production"', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'production' })).toThrow();
  });

  it('assertNotProduction does not throw for other NODE_ENV values', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertNotProduction({})).not.toThrow();
  });
});
