/**
 * Unit tests for the pure grant administration rules.
 */
import { describe, expect, it } from 'vitest';
import {
  PERMISSION_TEMPLATES,
  type GrantInput,
  type PermissionTemplateDefinition,
} from '@nestself/contracts';
import {
  checkDelegationBounds,
  findActiveTemplate,
  findInvitableTemplate,
  isOrgScopeType,
  missingConditionTypes,
} from './grant-rules.js';

function grant(overrides: Partial<GrantInput> = {}): GrantInput {
  return {
    id: 'grant_parent',
    subjectUserId: 'user_ivana',
    templateKey: 'employer_owner',
    actions: ['access.delegate', 'access.preview', 'people.invite'],
    scopeType: 'organization',
    scopeOrgId: 'org_sample',
    scopeOrgUnitId: null,
    includeDescendants: false,
    scopeRefKind: null,
    scopeRefId: null,
    conditions: [],
    validFrom: new Date('2026-01-01'),
    validUntil: null,
    delegationEnvelope: null,
    parentGrantId: null,
    revokedAt: null,
    ...overrides,
  };
}

function child(overrides: Partial<GrantInput> = {}): GrantInput {
  return grant({ id: 'proposed', subjectUserId: 'user_stefan', parentGrantId: 'grant_parent', actions: ['people.invite'], ...overrides });
}

describe('findActiveTemplate', () => {
  it('returns an active template by key', () => {
    expect(findActiveTemplate('team_manager')?.key).toBe('team_manager');
  });

  it('returns null for an unknown key', () => {
    expect(findActiveTemplate('no_such_template')).toBeNull();
  });

  it('returns null for an inactive template', () => {
    const inactive: PermissionTemplateDefinition = { ...PERMISSION_TEMPLATES.find((t) => t.key === 'hr_admin')!, isActive: false };
    expect(findActiveTemplate('hr_admin', [inactive])).toBeNull();
  });
});

describe('isOrgScopeType', () => {
  it('accepts organization and org_unit only', () => {
    expect(isOrgScopeType('organization')).toBe(true);
    expect(isOrgScopeType('org_unit')).toBe(true);
    expect(isOrgScopeType('platform')).toBe(false);
    expect(isOrgScopeType('own')).toBe(false);
    expect(isOrgScopeType('assigned_cases')).toBe(false);
  });
});

describe('missingConditionTypes', () => {
  it('lists every required type absent from the conditions', () => {
    expect(missingConditionTypes(['spending_ceiling', 'categories'], [{ type: 'categories', allowed: ['x'] }])).toEqual([
      'spending_ceiling',
    ]);
  });

  it('is empty when all required types are present', () => {
    expect(
      missingConditionTypes(['spending_ceiling'], [{ type: 'spending_ceiling', amountMinor: 1, currency: 'EUR' }]),
    ).toEqual([]);
  });
});

describe('checkDelegationBounds (parent grant as the bound, AUTHZ-R-37)', () => {
  it('accepts a subset of the parent actions at the same scope', () => {
    expect(checkDelegationBounds(grant(), child(), [])).toBeNull();
  });

  it('rejects an action the parent grant does not contain', () => {
    expect(checkDelegationBounds(grant(), child({ actions: ['people.invite', 'policy.manage'] }), [])).toBe(
      'actions_exceed_parent',
    );
  });

  it('organization parent accepts any org unit of the org', () => {
    expect(
      checkDelegationBounds(grant(), child({ scopeType: 'org_unit', scopeOrgUnitId: 'team_product', includeDescendants: true }), [
        'team_product',
        'ou_engineering',
      ]),
    ).toBeNull();
  });

  it('org_unit parent accepts its own unit', () => {
    const parent = grant({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering' });
    expect(checkDelegationBounds(parent, child({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering' }), ['ou_engineering'])).toBeNull();
  });

  it('org_unit parent rejects organization scope', () => {
    const parent = grant({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering' });
    expect(checkDelegationBounds(parent, child({ scopeType: 'organization' }), [])).toBe('scope_exceeds_parent');
  });

  it('org_unit parent without includeDescendants rejects a descendant unit', () => {
    const parent = grant({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering' });
    expect(
      checkDelegationBounds(parent, child({ scopeType: 'org_unit', scopeOrgUnitId: 'team_product' }), ['team_product', 'ou_engineering']),
    ).toBe('scope_exceeds_parent');
  });

  it('org_unit parent with includeDescendants accepts a descendant unit', () => {
    const parent = grant({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering', includeDescendants: true });
    expect(
      checkDelegationBounds(parent, child({ scopeType: 'org_unit', scopeOrgUnitId: 'team_product' }), ['team_product', 'ou_engineering']),
    ).toBeNull();
  });

  it('org_unit parent rejects a unit outside its subtree', () => {
    const parent = grant({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering', includeDescendants: true });
    expect(
      checkDelegationBounds(parent, child({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_sales' }), ['ou_sales']),
    ).toBe('scope_exceeds_parent');
  });

  it('org_unit parent without includeDescendants rejects includeDescendants on the child', () => {
    const parent = grant({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering' });
    expect(
      checkDelegationBounds(parent, child({ scopeType: 'org_unit', scopeOrgUnitId: 'ou_engineering', includeDescendants: true }), [
        'ou_engineering',
      ]),
    ).toBe('scope_exceeds_parent');
  });

  it('rejects delegation from a parent outside the organization scopes', () => {
    const parent = grant({ scopeType: 'own', scopeOrgId: null });
    expect(checkDelegationBounds(parent, child(), [])).toBe('scope_exceeds_parent');
  });

  it('spending ceiling must not exceed the parent ceiling in the same currency', () => {
    const parent = grant({ conditions: [{ type: 'spending_ceiling', amountMinor: 1000, currency: 'EUR' }] });
    expect(
      checkDelegationBounds(parent, child({ conditions: [{ type: 'spending_ceiling', amountMinor: 1000, currency: 'EUR' }] }), []),
    ).toBeNull();
    expect(
      checkDelegationBounds(parent, child({ conditions: [{ type: 'spending_ceiling', amountMinor: 1001, currency: 'EUR' }] }), []),
    ).toBe('spending_ceiling_exceeds_parent');
  });

  it('a child without the parent currency ceiling exceeds the parent', () => {
    const parent = grant({ conditions: [{ type: 'spending_ceiling', amountMinor: 1000, currency: 'EUR' }] });
    expect(checkDelegationBounds(parent, child(), [])).toBe('spending_ceiling_exceeds_parent');
    expect(
      checkDelegationBounds(parent, child({ conditions: [{ type: 'spending_ceiling', amountMinor: 10, currency: 'RSD' }] }), []),
    ).toBe('spending_ceiling_exceeds_parent');
  });

  it('categories must be a subset of the parent categories', () => {
    const parent = grant({ conditions: [{ type: 'categories', allowed: ['a', 'b'] }] });
    expect(checkDelegationBounds(parent, child({ conditions: [{ type: 'categories', allowed: ['a'] }] }), [])).toBeNull();
    expect(checkDelegationBounds(parent, child({ conditions: [{ type: 'categories', allowed: ['a', 'c'] }] }), [])).toBe(
      'categories_exceed_parent',
    );
    expect(checkDelegationBounds(parent, child(), [])).toBe('categories_exceed_parent');
  });

  it('a parent without conditions does not constrain the child conditions', () => {
    expect(
      checkDelegationBounds(grant(), child({ conditions: [{ type: 'spending_ceiling', amountMinor: 5, currency: 'EUR' }] }), []),
    ).toBeNull();
  });
});

describe('findInvitableTemplate', () => {
  it('returns organization and employee templates', () => {
    expect(findInvitableTemplate('hr_admin')?.key).toBe('hr_admin');
    expect(findInvitableTemplate('employee')?.key).toBe('employee');
  });

  it('refuses operations, expert, unknown and inactive templates', () => {
    expect(findInvitableTemplate('platform_owner')).toBeNull();
    expect(findInvitableTemplate('client_operations')).toBeNull();
    expect(findInvitableTemplate('expert')).toBeNull();
    expect(findInvitableTemplate('nonexistent')).toBeNull();
    const inactive = PERMISSION_TEMPLATES.map((t) =>
      t.key === 'hr_admin' ? { ...t, isActive: false } : t,
    );
    expect(findInvitableTemplate('hr_admin', inactive)).toBeNull();
  });
});
