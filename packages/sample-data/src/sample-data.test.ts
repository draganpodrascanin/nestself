import { describe, it, expect } from 'vitest';
import { InvitationResponseSchema, PERMISSION_TEMPLATES } from '@nestself/contracts';
import {
  SAMPLE_ORG,
  SAMPLE_TEAMS,
  SAMPLE_PEOPLE,
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
  isSampleMode,
  assertNotProduction,
} from './index.ts';
const QUOTE_LOCALES = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const;

describe('sample-data fixtures', () => {
  const allFixtures: ReadonlyArray<object> = [
    SAMPLE_ORG,
    ...SAMPLE_TEAMS,
    ...SAMPLE_PEOPLE,
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
