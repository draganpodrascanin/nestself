import { describe, it, expect } from 'vitest';
import { GrantResponseSchema, PERMISSION_TEMPLATES } from '@nestself/contracts';
import { SAMPLE_GRANTS, SAMPLE_PEOPLE } from '../index.ts';

describe('SAMPLE_GRANTS', () => {
  it('every row validates against GrantResponseSchema and is marked as sample', () => {
    expect(SAMPLE_GRANTS.length).toBeGreaterThan(0);
    for (const grant of SAMPLE_GRANTS) {
      expect(GrantResponseSchema.safeParse(grant).success).toBe(true);
      expect(grant.sample).toBe(true);
    }
  });

  it('has unique ids of the form grant_{userId}_{templateKey}', () => {
    const ids = SAMPLE_GRANTS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of SAMPLE_GRANTS) expect(g.id).toBe(`grant_${g.subjectUserId}_${g.templateKey}`);
  });

  it('derives grants from the legacy role and gives every org member the employee template', () => {
    const keysOf = (userId: string) =>
      SAMPLE_GRANTS.filter((g) => g.subjectUserId === userId).map((g) => g.templateKey);
    expect(keysOf('user_jovan')).toEqual(['employee']);
    expect(keysOf('user_stefan')).toEqual(expect.arrayContaining(['team_manager', 'employee']));
    expect(keysOf('user_ivana')).toEqual(expect.arrayContaining(['hr_admin', 'employee']));
    expect(keysOf('user_milica')).not.toContain('employee');
  });

  it('gives user_ivana the employer owner template at organization scope', () => {
    const owner = SAMPLE_GRANTS.find((g) => g.id === 'grant_user_ivana_employer_owner');
    expect(owner).toBeDefined();
    expect(owner!.subjectUserId).toBe('user_ivana');
    expect(owner!.templateKey).toBe('employer_owner');
    expect(owner!.scopeType).toBe('organization');
    expect(owner!.scopeOrgId).toBe('org_sample');
    expect(owner!.scopeOrgUnitId).toBeNull();
    expect(SAMPLE_GRANTS.filter((g) => g.templateKey === 'employer_owner')).toHaveLength(1);
  });

  it('copies template actions and resolves scope', () => {
    for (const g of SAMPLE_GRANTS) {
      const tmpl = PERMISSION_TEMPLATES.find((t) => t.key === g.templateKey)!;
      expect(g.actions).toEqual([...tmpl.actions]);
      expect(g.scopeType).toBe(tmpl.scopeType);
      if (g.scopeType === 'platform') expect(g.scopeOrgId).toBeNull();
      if (g.scopeType === 'org_unit') {
        expect(g.scopeOrgUnitId).toBe('team_product');
        expect(g.includeDescendants).toBe(true);
      }
    }
  });

  it('is granted by user_ivana, never revoked, and covers only known people', () => {
    const ids = new Set<string>(SAMPLE_PEOPLE.map((p) => p.id));
    for (const g of SAMPLE_GRANTS) {
      expect(g.grantedByUserId).toBe('user_ivana');
      expect(g.revokedAt).toBeNull();
      expect(ids.has(g.subjectUserId)).toBe(true);
    }
  });
});
