import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS, PERMISSION_TEMPLATES } from './templates.ts';
import { isAction } from './actions.ts';
import { STEP_UP_CLASS_BY_ACTION } from './authorization.ts';

describe('templates', () => {
  it('TEMPLATE_KEYS has exactly 17 entries', () => {
    expect(TEMPLATE_KEYS).toHaveLength(17);
  });

  it('PERMISSION_TEMPLATES has exactly 17 entries', () => {
    expect(PERMISSION_TEMPLATES).toHaveLength(17);
  });

  it('every template key in PERMISSION_TEMPLATES is unique', () => {
    const keys = PERMISSION_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every template key appears in TEMPLATE_KEYS', () => {
    const keySet = new Set<string>(TEMPLATE_KEYS);
    for (const t of PERMISSION_TEMPLATES) {
      expect(keySet.has(t.key)).toBe(true);
    }
  });

  it('every TEMPLATE_KEYS entry has a matching PERMISSION_TEMPLATES row', () => {
    const definedKeys = new Set(PERMISSION_TEMPLATES.map((t) => t.key));
    for (const k of TEMPLATE_KEYS) {
      expect(definedKeys.has(k)).toBe(true);
    }
  });

  it('every action in every template is a valid Action', () => {
    for (const t of PERMISSION_TEMPLATES) {
      for (const a of t.actions) {
        expect(isAction(a), `${t.key} contains invalid action "${a}"`).toBe(true);
      }
    }
  });

  it('stepUpActions are subset of template actions or in STEP_UP_CLASS_BY_ACTION', () => {
    for (const t of PERMISSION_TEMPLATES) {
      for (const a of t.stepUpActions) {
        const inTemplate = (t.actions as readonly string[]).includes(a);
        const inGlobal = a in STEP_UP_CLASS_BY_ACTION;
        expect(
          inTemplate || inGlobal,
          `${t.key} stepUpAction "${a}" not in template actions or global step-up table`,
        ).toBe(true);
      }
    }
  });

  it('every template has a valid workspace', () => {
    const validWorkspaces = ['employee', 'organization', 'expert', 'operations'];
    for (const t of PERMISSION_TEMPLATES) {
      expect(validWorkspaces).toContain(t.workspace);
    }
  });

  it('every template has a valid population', () => {
    const validPopulations = ['employee', 'employer_admin', 'expert', 'staff', 'external'];
    for (const t of PERMISSION_TEMPLATES) {
      expect(validPopulations).toContain(t.population);
    }
  });

  it('every template has a valid scopeType', () => {
    const validScopes = [
      'platform', 'organization', 'org_unit', 'assigned_clients',
      'assigned_queues', 'assigned_cases', 'assigned_practice',
      'assigned_collections', 'own',
    ];
    for (const t of PERMISSION_TEMPLATES) {
      expect(validScopes).toContain(t.scopeType);
    }
  });

  it('requiredConditionTypes is a valid condition-type array', () => {
    const validTypes = ['spending_ceiling', 'categories', 'confidential_approver', 'time_window'];
    for (const t of PERMISSION_TEMPLATES) {
      expect(Array.isArray(t.requiredConditionTypes)).toBe(true);
      for (const ct of t.requiredConditionTypes) {
        expect(validTypes, `${t.key} has invalid requiredConditionType "${ct}"`).toContain(ct);
      }
    }
  });

  it('expert template reaches assigned conversations (strategy 4.7.3 assigned-expert path)', () => {
    const expert = PERMISSION_TEMPLATES.find((t) => t.key === 'expert')!;
    expect(expert.scopeType).toBe('assigned_cases');
    expect(expert.actions).toContain('conversation.read.assigned');
    expect(expert.stepUpActions).toContain('conversation.read.assigned');
  });

  it('specific templates have the expected requiredConditionTypes', () => {
    const byKey = (k: string) => PERMISSION_TEMPLATES.find((t) => t.key === k)!;
    expect([...byKey('expert').requiredConditionTypes]).toEqual(['categories']);
    expect([...byKey('team_manager').requiredConditionTypes]).toEqual(['spending_ceiling']);
    expect([...byKey('approver').requiredConditionTypes]).toEqual(['spending_ceiling', 'categories']);
    expect([...byKey('employer_finance').requiredConditionTypes]).toEqual(['spending_ceiling']);
    expect([...byKey('event_supplier').requiredConditionTypes]).toEqual(['time_window']);
  });

  it('templates without required conditions have an empty array', () => {
    const withRequired = new Set(['expert', 'team_manager', 'approver', 'employer_finance', 'event_supplier']);
    for (const t of PERMISSION_TEMPLATES) {
      if (!withRequired.has(t.key)) {
        expect(
          t.requiredConditionTypes,
          `${t.key} should have empty requiredConditionTypes`,
        ).toHaveLength(0);
      }
    }
  });
});
