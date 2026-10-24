import { describe, expect, it } from 'vitest';
import { templatesForLegacyRoles } from './seed-lib.js';

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
