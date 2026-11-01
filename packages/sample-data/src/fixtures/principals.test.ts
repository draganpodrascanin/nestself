import { describe, it, expect } from 'vitest';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '../index.ts';

function templateActions(key: string): readonly string[] {
  return PERMISSION_TEMPLATES.find((t) => t.key === key)!.actions;
}

describe('SAMPLE_PRINCIPALS', () => {
  it('gives the HR admin persona the employee, HR admin and employer owner actions', () => {
    const actions = SAMPLE_PRINCIPALS.hr_admin.effectiveActions;
    for (const key of ['employee', 'hr_admin', 'employer_owner']) {
      for (const action of templateActions(key)) expect(actions).toContain(action);
    }
    expect(actions).toContain('access.preview');
    expect(actions).toContain('access.delegate');
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('gives the listening roles of ADR 0002 to the right personas', () => {
    expect(SAMPLE_PRINCIPALS.hr_admin.effectiveActions).toEqual(
      expect.arrayContaining(['listening.cycles.manage', 'listening.reports.read', 'workplace_reviews.request', 'workplace_reviews.scope.accept', 'feedback_case.handle']),
    );
    expect(SAMPLE_PRINCIPALS.manager.effectiveActions).toContain('feedback_case.handle');
    expect(SAMPLE_PRINCIPALS.expert.effectiveActions).toContain('workplace_reviews.report.write');
    expect(SAMPLE_PRINCIPALS.operations.effectiveActions).toEqual(
      expect.arrayContaining(['workplace_reviews.coordinate', 'listening.configure', 'listening.templates.publish']),
    );
    const employee = SAMPLE_PRINCIPALS.employee.effectiveActions;
    expect(employee).toEqual(expect.arrayContaining(['listening.respond.self', 'feedback_case.create.self']));
    expect(employee).not.toContain('listening.reports.read');
    expect(employee).not.toContain('feedback_case.handle');
  });

  it('does not give the employee persona any access-management action', () => {
    const actions = SAMPLE_PRINCIPALS.employee.effectiveActions;
    expect(actions.some((a) => a.startsWith('access.'))).toBe(false);
  });
});
