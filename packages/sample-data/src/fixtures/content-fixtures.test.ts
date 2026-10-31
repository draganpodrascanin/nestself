import { describe, it, expect } from 'vitest';
// @nestself/content is not a dependency of this package (no installs while
// parallel work runs), so the schema is imported by path. Add the workspace
// dependency and switch to '@nestself/content/schema' at the next install.
// The path is dynamic so this package's typecheck does not compile the other
// package's sources.
import {
  SAMPLE_ACCEPTANCE_PEOPLE,
  SAMPLE_ACCEPTANCE_ROLES,
  SAMPLE_ACCEPTANCE_SCALE,
  SAMPLE_CATEGORY_ID_LIST,
  SAMPLE_CONTENT_RESOURCES,
  SAMPLE_EDITORIAL_STAFF,
  SAMPLE_EXTERNAL_IDENTITIES,
  SAMPLE_ORG,
  SAMPLE_ORG_B,
  SAMPLE_ORG_B_UNITS,
  SAMPLE_ACCEPTANCE_PRINCIPALS,
  SAMPLE_PEOPLE,
  acceptanceScaleEmployees,
} from '../index.ts';

declare const URL: new (path: string, base: string) => { href: string };
const schemaPath = new URL(
  '../../../content/src/schema/index.ts',
  (import.meta as unknown as { url: string }).url,
).href;
const { validateContentDocument } = (await import(/* @vite-ignore */ schemaPath)) as {
  validateContentDocument: (doc: unknown) => { ok: boolean };
};

describe('SAMPLE_CONTENT_RESOURCES', () => {
  const variants = SAMPLE_CONTENT_RESOURCES.flatMap((r) => r.variants);

  it('has unique, SAMPLE-prefixed ids', () => {
    const ids = [...SAMPLE_CONTENT_RESOURCES.map((r) => r.id), ...variants.map((v) => v.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of SAMPLE_CONTENT_RESOURCES) expect(r.id).toMatch(/^res_sample_/);
    for (const v of variants) expect(v.id).toMatch(/^var_/);
  });

  it('flags every resource as a placeholder', () => {
    for (const r of SAMPLE_CONTENT_RESOURCES) expect(r.placeholder).toBe(true);
  });

  it('gives every resource exactly the three authored locales and no sr-Cyrl', () => {
    for (const r of SAMPLE_CONTENT_RESOURCES) {
      expect(r.variants.map((v) => v.locale).sort()).toEqual(['en', 'hu', 'sr-Latn']);
    }
    expect(variants.map((v) => v.locale as string)).not.toContain('sr-Cyrl');
  });

  it('has unique slugs per locale', () => {
    const keys = variants.map((v) => `${v.locale}/${v.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses launch categories and covers every availability scenario', () => {
    for (const r of SAMPLE_CONTENT_RESOURCES) {
      expect(SAMPLE_CATEGORY_ID_LIST).toContain(r.primaryCategoryId);
    }
    expect(new Set(SAMPLE_CONTENT_RESOURCES.map((r) => r.scenario))).toEqual(
      new Set(['all_eligible', 'org_a', 'future', 'withdrawn']),
    );
  });

  it('has bodies that pass validateContentDocument', () => {
    for (const v of variants) {
      const result = validateContentDocument(v.body);
      expect({ id: v.id, ok: result.ok }).toEqual({ id: v.id, ok: true });
    }
  });

  it('has non-empty summary and outcome for every variant', () => {
    for (const v of variants) {
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.summary.length).toBeGreaterThan(0);
      expect(v.outcome.length).toBeGreaterThan(0);
    }
  });
});

describe('acceptance people', () => {
  it('names unique people, none already in SAMPLE_PEOPLE or the editorial staff', () => {
    const ids = [
      ...SAMPLE_PEOPLE.map((p) => p.id),
      ...SAMPLE_EDITORIAL_STAFF.map((p) => p.id),
      ...SAMPLE_ACCEPTANCE_PEOPLE.map((p) => p.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('maps every acceptance role to an existing person', () => {
    const known = new Set([
      ...SAMPLE_PEOPLE.map((p) => p.id),
      ...SAMPLE_EDITORIAL_STAFF.map((p) => p.id),
      ...SAMPLE_ACCEPTANCE_PEOPLE.map((p) => p.id),
    ]);
    for (const id of Object.values(SAMPLE_ACCEPTANCE_ROLES)) expect(known).toContain(id);
  });

  it('gives the multi-org person memberships in both organizations', () => {
    const dual = SAMPLE_ACCEPTANCE_PEOPLE.find((p) => p.id === SAMPLE_ACCEPTANCE_ROLES.multiOrgEmployee);
    expect(dual?.memberships.map((m) => m.orgId).sort()).toEqual([SAMPLE_ORG.id, SAMPLE_ORG_B.id].sort());
    const ctx = SAMPLE_ACCEPTANCE_PRINCIPALS.multiOrgEmployee.availableContexts;
    expect(ctx).toHaveLength(2);
  });

  it('places organization B people in organization B units', () => {
    const unitIds = new Set<string>(SAMPLE_ORG_B_UNITS.map((u) => u.id));
    const b = SAMPLE_ACCEPTANCE_PEOPLE.find((p) => p.id === SAMPLE_ACCEPTANCE_ROLES.employeeB)!;
    expect(b.memberships.every((m) => m.orgId === SAMPLE_ORG_B.id && unitIds.has(m.orgUnitId))).toBe(true);
  });

  it('signs them in by email code in stub mode', () => {
    for (const p of SAMPLE_ACCEPTANCE_PEOPLE) {
      const identity = SAMPLE_EXTERNAL_IDENTITIES.find((i) => i.userId === p.id);
      expect(identity?.signIn).toBe('email_otp');
      expect(identity?.sample).toBe(true);
    }
  });

  it('generates deterministic employees that bring the organizations to 30 and 12', () => {
    const first = acceptanceScaleEmployees();
    expect(acceptanceScaleEmployees()).toEqual(first);
    expect(new Set(first.map((e) => e.id)).size).toBe(first.length);
    const named = (orgId: string) =>
      SAMPLE_PEOPLE.filter((p) => p.orgId === orgId).length +
      SAMPLE_ACCEPTANCE_PEOPLE.filter((p) => p.memberships.some((m) => m.orgId === orgId)).length;
    const generated = (orgId: string) => first.filter((e) => e.orgId === orgId).length;
    expect(named(SAMPLE_ORG.id) + generated(SAMPLE_ORG.id)).toBe(SAMPLE_ACCEPTANCE_SCALE.orgA);
    expect(named(SAMPLE_ORG_B.id) + generated(SAMPLE_ORG_B.id)).toBe(SAMPLE_ACCEPTANCE_SCALE.orgB);
  });
});
