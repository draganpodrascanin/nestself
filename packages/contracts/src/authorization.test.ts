import { describe, expect, it } from 'vitest';
import {
  GrantConditionSchema,
  WorkspaceSchema,
  PopulationSchema,
  ScopeTypeSchema,
  STEP_UP_MAX_AGE_SECONDS,
  STEP_UP_CLASS_BY_ACTION,
} from './authorization.ts';
import { isAction } from './actions.ts';

describe('GrantConditionSchema', () => {
  it('accepts a valid spending_ceiling', () => {
    const result = GrantConditionSchema.parse({
      type: 'spending_ceiling',
      amountMinor: 50000,
      currency: 'EUR',
    });
    expect(result.type).toBe('spending_ceiling');
  });

  it('accepts a valid categories condition', () => {
    const result = GrantConditionSchema.parse({
      type: 'categories',
      allowed: ['psychological', 'legal'],
    });
    expect(result.type).toBe('categories');
  });

  it('accepts a valid confidential_approver', () => {
    const result = GrantConditionSchema.parse({
      type: 'confidential_approver',
    });
    expect(result.type).toBe('confidential_approver');
  });

  it('accepts a valid time_window', () => {
    const result = GrantConditionSchema.parse({
      type: 'time_window',
      days: [1, 2, 3, 4, 5],
      from: '08:00',
      to: '17:00',
    });
    expect(result.type).toBe('time_window');
  });

  it('rejects unknown discriminator', () => {
    expect(() =>
      GrantConditionSchema.parse({ type: 'unknown_condition' }),
    ).toThrow();
  });

  it('rejects negative amountMinor', () => {
    expect(() =>
      GrantConditionSchema.parse({
        type: 'spending_ceiling',
        amountMinor: -100,
        currency: 'EUR',
      }),
    ).toThrow();
  });

  it('rejects currency with wrong length', () => {
    expect(() =>
      GrantConditionSchema.parse({
        type: 'spending_ceiling',
        amountMinor: 100,
        currency: 'EURO',
      }),
    ).toThrow();
  });

  it('rejects empty categories allowed array', () => {
    expect(() =>
      GrantConditionSchema.parse({
        type: 'categories',
        allowed: [],
      }),
    ).toThrow();
  });

  it('rejects bad time format in time_window', () => {
    expect(() =>
      GrantConditionSchema.parse({
        type: 'time_window',
        days: [1],
        from: '8:00',
        to: '17:00',
      }),
    ).toThrow();
  });

  it('rejects empty days array in time_window', () => {
    expect(() =>
      GrantConditionSchema.parse({
        type: 'time_window',
        days: [],
        from: '08:00',
        to: '17:00',
      }),
    ).toThrow();
  });

  it('rejects day out of range in time_window', () => {
    expect(() =>
      GrantConditionSchema.parse({
        type: 'time_window',
        days: [7],
        from: '08:00',
        to: '17:00',
      }),
    ).toThrow();
  });
});

describe('STEP_UP_MAX_AGE_SECONDS', () => {
  it('has all 5 classes with correct values', () => {
    expect(STEP_UP_MAX_AGE_SECONDS.emergency).toBe(300);
    expect(STEP_UP_MAX_AGE_SECONDS.restricted).toBe(900);
    expect(STEP_UP_MAX_AGE_SECONDS.export).toBe(900);
    expect(STEP_UP_MAX_AGE_SECONDS.financial).toBe(900);
    expect(STEP_UP_MAX_AGE_SECONDS.administration).toBe(1800);
  });
});

describe('STEP_UP_CLASS_BY_ACTION', () => {
  it('covers the documented financial actions', () => {
    expect(STEP_UP_CLASS_BY_ACTION['spend.approve']).toBe('financial');
    expect(STEP_UP_CLASS_BY_ACTION['funding.allocate']).toBe('financial');
    expect(STEP_UP_CLASS_BY_ACTION['budget.allocate']).toBe('financial');
  });

  it('covers the documented administration actions', () => {
    expect(STEP_UP_CLASS_BY_ACTION['access.grant']).toBe('administration');
    expect(STEP_UP_CLASS_BY_ACTION['access.revoke']).toBe('administration');
    expect(STEP_UP_CLASS_BY_ACTION['access.delegate']).toBe('administration');
    expect(STEP_UP_CLASS_BY_ACTION['sso.manage']).toBe('administration');
    expect(STEP_UP_CLASS_BY_ACTION['people.deactivate']).toBe('administration');
    expect(STEP_UP_CLASS_BY_ACTION['session.revoke.any']).toBe('administration');
  });

  it('covers the documented restricted actions', () => {
    expect(STEP_UP_CLASS_BY_ACTION['conversation.read.assigned']).toBe('restricted');
    expect(STEP_UP_CLASS_BY_ACTION['notes.read.supervision']).toBe('restricted');
    expect(STEP_UP_CLASS_BY_ACTION['records.read.emergency']).toBe('restricted');
  });

  it('covers the documented export actions', () => {
    expect(STEP_UP_CLASS_BY_ACTION['report.export']).toBe('export');
    expect(STEP_UP_CLASS_BY_ACTION['data.export.own']).toBe('export');
  });

  it('covers the documented emergency actions', () => {
    expect(STEP_UP_CLASS_BY_ACTION['access.emergency.request']).toBe('emergency');
    expect(STEP_UP_CLASS_BY_ACTION['access.emergency.approve']).toBe('emergency');
  });

  it('every key is a valid Action', () => {
    for (const key of Object.keys(STEP_UP_CLASS_BY_ACTION)) {
      expect(isAction(key), `"${key}" is not a valid Action`).toBe(true);
    }
  });
});

describe('ScopeTypeSchema', () => {
  it('accepts all valid scope types', () => {
    const valid = [
      'platform', 'organization', 'org_unit', 'assigned_clients',
      'assigned_queues', 'assigned_cases', 'assigned_practice',
      'assigned_collections', 'own',
    ];
    for (const v of valid) {
      expect(ScopeTypeSchema.parse(v)).toBe(v);
    }
  });

  it('rejects invalid scope types', () => {
    expect(() => ScopeTypeSchema.parse('global')).toThrow();
    expect(() => ScopeTypeSchema.parse('')).toThrow();
  });
});

describe('WorkspaceSchema', () => {
  it('accepts valid workspaces', () => {
    expect(WorkspaceSchema.parse('employee')).toBe('employee');
    expect(WorkspaceSchema.parse('organization')).toBe('organization');
    expect(WorkspaceSchema.parse('expert')).toBe('expert');
    expect(WorkspaceSchema.parse('operations')).toBe('operations');
  });

  it('rejects invalid workspace', () => {
    expect(() => WorkspaceSchema.parse('admin')).toThrow();
  });
});

describe('PopulationSchema', () => {
  it('accepts valid populations', () => {
    expect(PopulationSchema.parse('employee')).toBe('employee');
    expect(PopulationSchema.parse('employer_admin')).toBe('employer_admin');
    expect(PopulationSchema.parse('expert')).toBe('expert');
    expect(PopulationSchema.parse('staff')).toBe('staff');
    expect(PopulationSchema.parse('external')).toBe('external');
  });

  it('rejects invalid population', () => {
    expect(() => PopulationSchema.parse('user')).toThrow();
  });
});
