import { describe, it, expect } from 'vitest';
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
