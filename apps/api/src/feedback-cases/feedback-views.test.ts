import { describe, expect, it } from 'vitest';
import { HandlerFeedbackCaseResponseSchema, MyFeedbackCaseResponseSchema } from '@nestself/contracts';
import type { CaseRow, MessageRow } from './feedback-cases.repository.js';
import { reporterVisible, toHandlerSummary, toHandlerView, toReporterView } from './feedback-views.js';

const NOW = new Date('2026-11-03T10:00:00.000Z');

const CASE: CaseRow = {
  id: 'case_1',
  orgId: 'org_sample',
  routeId: 'route_1',
  kind: 'problem',
  category: 'workload',
  anonymousToEmployer: true,
  pseudonym: 'Reporter-AB2C',
  state: 'in_review',
  routeChoice: 'alternate',
  handlerUserId: 'user_ivana',
  nextAction: 'respond',
  dueAt: new Date('2026-11-02T09:00:00.000Z'),
  escalatedAt: null,
  resolvedAt: null,
  closedAt: null,
  outcomeReason: null,
  lastReporterVisibleAt: null,
  createdAt: new Date('2026-11-01T09:00:00.000Z'),
  updatedAt: new Date('2026-11-01T09:00:00.000Z'),
};

const MESSAGES: MessageRow[] = [
  { id: 'm1', caseId: 'case_1', orgId: 'org_sample', sender: 'reporter', authorUserId: null, body: 'The rota changes without notice.', internal: false, createdAt: new Date('2026-11-01T09:00:00.000Z') },
  { id: 'm2', caseId: 'case_1', orgId: 'org_sample', sender: 'handler', authorUserId: 'user_ivana', body: 'Check with scheduling.', internal: true, createdAt: new Date('2026-11-01T10:00:00.000Z') },
  { id: 'm3', caseId: 'case_1', orgId: 'org_sample', sender: 'handler', authorUserId: 'user_ivana', body: 'Thank you, we are looking into it.', internal: false, createdAt: new Date('2026-11-01T11:00:00.000Z') },
];

describe('feedback views', () => {
  it('the handler view drops a reporter column that leaked onto the row and passes the strict schema', () => {
    const leaked = { ...CASE, reporterUserId: 'user_jovan', reporterEmail: 'jovan@example.com' } as CaseRow;
    const view = toHandlerView(leaked, 'standard', MESSAGES);
    expect(view).not.toHaveProperty('reporterUserId');
    expect(view).not.toHaveProperty('reporterEmail');
    expect(JSON.stringify(view)).not.toContain('user_jovan');
    expect(HandlerFeedbackCaseResponseSchema.safeParse(view).success).toBe(true);
    expect(view.messages).toHaveLength(3);
    expect(view.messages[1]).toMatchObject({ internal: true, sender: 'handler' });
  });

  it('the reporter view never carries internal notes, handler ids or the organization', () => {
    const view = toReporterView(CASE, 'standard', MESSAGES);
    expect(view.messages.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(JSON.stringify(view)).not.toMatch(/user_ivana|authorUserId|org_sample|handlerUserId/);
    expect(view.handlerFunction).toBe('alternate');
    expect(MyFeedbackCaseResponseSchema.safeParse(view).success).toBe(true);
    expect(reporterVisible(MESSAGES).every((m) => !m.internal)).toBe(true);
  });

  it('a handler summary flags an overdue open case and not a resolved one', () => {
    expect(toHandlerSummary(CASE, 'standard', null, NOW).overdue).toBe(true);
    expect(toHandlerSummary({ ...CASE, state: 'resolved' }, 'standard', null, NOW).overdue).toBe(false);
    expect(toHandlerSummary({ ...CASE, dueAt: new Date('2026-11-04T09:00:00.000Z') }, 'standard', null, NOW).overdue).toBe(false);
  });
});
