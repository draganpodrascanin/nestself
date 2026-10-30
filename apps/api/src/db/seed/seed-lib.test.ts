import { describe, expect, it } from 'vitest';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { SAMPLE_CATEGORY_IDS, SAMPLE_EDITORIAL_STAFF, SAMPLE_GRANTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import { EXTRA_SAMPLE_TEMPLATES, editorialStaffGrantIds, extraSampleGrantIds, templatesForLegacyRoles } from './seed-lib.js';

const keys = (orgRole: string | null, platformRole: string | null) =>
  templatesForLegacyRoles(orgRole, platformRole)
    .map((tmpl) => tmpl.key)
    .sort();

describe('templatesForLegacyRoles', () => {
  it('maps a plain employee to the employee template only', () => {
    expect(keys('EMPLOYEE', null)).toEqual(['employee']);
  });

  it('adds the employee template to every org role', () => {
    expect(keys('MANAGER', null)).toEqual(['employee', 'team_manager']);
    expect(keys('HR_ADMIN', null)).toEqual(['employee', 'hr_admin']);
  });

  it('maps platform roles without the employee template', () => {
    expect(keys(null, 'EXPERT')).toEqual(['expert', 'expert_lead']);
    expect(keys(null, 'ADMIN')).toEqual(['platform_owner']);
    expect(keys(null, 'OPERATIONS')).toEqual(
      [
        'client_operations',
        'content_author',
        'content_publisher',
        'nestself_finance',
        'service_coordinator',
        'support_operator',
      ].sort(),
    );
  });

  it('never derives the editorial templates from the operations role', () => {
    const operations = keys(null, 'OPERATIONS');
    expect(operations).not.toContain('content_reviewer');
    expect(operations).not.toContain('editorial_lead');
  });

  it('accepts lower-case fixture roles', () => {
    expect(keys('hr_admin', null)).toEqual(['employee', 'hr_admin']);
  });

  it('never derives a template that has no legacy role', () => {
    for (const [org, platform] of [
      [null, null],
      ['EMPLOYEE', null],
      [null, 'EXPERT'],
    ] as const) {
      expect(templatesForLegacyRoles(org, platform).every((tmpl) => tmpl.legacyRole != null)).toBe(true);
    }
    expect(keys(null, null)).toEqual([]);
  });
});

describe('EXTRA_SAMPLE_TEMPLATES', () => {
  it('makes the sample HR admin the employer owner as well', () => {
    expect(EXTRA_SAMPLE_TEMPLATES).toEqual({ user_ivana: ['employer_owner'] });
    expect(extraSampleGrantIds()).toEqual(['grant_user_ivana_employer_owner']);
  });

  it('gives employer_owner to exactly one person in org_sample: Ivana (owner model)', () => {
    const owners = SAMPLE_PEOPLE.filter((p) => p.orgId === 'org_sample').filter((p) => {
      const derived = templatesForLegacyRoles(p.orgRole ?? null, p.platformRole ?? null).map((tmpl) => tmpl.key);
      const extra = EXTRA_SAMPLE_TEMPLATES[p.id] ?? [];
      return [...derived, ...extra].includes('employer_owner');
    });
    expect(owners.map((p) => p.id)).toEqual(['user_ivana']);
    expect(SAMPLE_GRANTS.filter((g) => g.id.endsWith('_employer_owner')).map((g) => g.id)).toEqual([
      'grant_user_ivana_employer_owner',
    ]);
  });

  it('names only known templates', () => {
    const known = new Set<string>(PERMISSION_TEMPLATES.map((tmpl) => tmpl.key));
    expect(Object.values(EXTRA_SAMPLE_TEMPLATES).flat().every((key) => known.has(key))).toBe(true);
  });

  it('seeds the same 21 grant ids as SAMPLE_GRANTS', () => {
    const derived = SAMPLE_PEOPLE.filter((p) => p.orgId || p.platformRole).flatMap((p) =>
      templatesForLegacyRoles(p.orgRole ?? null, p.platformRole ?? null).map((tmpl) => `grant_${p.id}_${tmpl.key}`),
    );
    const seeded = [...derived, ...extraSampleGrantIds(), ...editorialStaffGrantIds()].sort();
    expect(seeded).toHaveLength(21);
    expect(seeded).toEqual(SAMPLE_GRANTS.map((g) => g.id).sort());
  });
});

describe('SAMPLE_EDITORIAL_STAFF', () => {
  it('covers the four editorial templates once each', () => {
    expect(SAMPLE_EDITORIAL_STAFF.map((s) => s.templateKey).sort()).toEqual([
      'content_author',
      'content_publisher',
      'content_reviewer',
      'editorial_lead',
    ]);
    expect(editorialStaffGrantIds().sort()).toEqual(
      SAMPLE_EDITORIAL_STAFF.map((s) => `grant_${s.id}_${s.templateKey}`).sort(),
    );
  });

  it('is never derived from a legacy role', () => {
    const known = new Set<string>(PERMISSION_TEMPLATES.map((tmpl) => tmpl.key));
    for (const staff of SAMPLE_EDITORIAL_STAFF) {
      expect(known.has(staff.templateKey)).toBe(true);
      expect(SAMPLE_PEOPLE.some((p) => (p.id as string) === staff.id)).toBe(false);
    }
  });

  it('gives the reviewer the psychological and general disciplines', () => {
    const reviewer = SAMPLE_EDITORIAL_STAFF.find((s) => s.templateKey === 'content_reviewer')!;
    expect([...reviewer.disciplines]).toEqual(['psychological', 'general']);
  });

  it('assigns author, reviewer and publisher to all six categories', () => {
    const all = Object.values(SAMPLE_CATEGORY_IDS).sort();
    expect(all).toHaveLength(6);
    for (const key of ['content_author', 'content_reviewer', 'content_publisher']) {
      const staff = SAMPLE_EDITORIAL_STAFF.find((s) => s.templateKey === key)!;
      expect([...staff.categoryIds].sort()).toEqual(all);
    }
  });
});
