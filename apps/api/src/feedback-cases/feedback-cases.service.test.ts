import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { CaseRow, RouteRow } from './feedback-cases.repository.js';
import { FeedbackCasesService, addHours, defaultNextAction } from './feedback-cases.service.js';
import { FeedbackRoutesService } from './feedback-routes.service.js';

const NOW = new Date('2026-11-03T10:00:00.000Z');
const ORG = 'org_sample';

const ROUTE: RouteRow = {
  id: 'route_std',
  orgId: ORG,
  kind: 'standard',
  categories: ['workload', 'other'],
  primaryHandlerUserId: 'user_stefan',
  alternateHandlerUserId: 'user_ivana',
  enabled: true,
  operatingHours: null,
  responseTargetHours: 72,
  escalationNote: null,
  updatedByUserId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function caseRow(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: 'case_1',
    orgId: ORG,
    routeId: ROUTE.id,
    kind: 'problem',
    category: 'workload',
    anonymousToEmployer: true,
    pseudonym: 'Reporter-AB2C',
    state: 'submitted',
    routeChoice: 'alternate',
    handlerUserId: 'user_ivana',
    nextAction: 'acknowledge',
    dueAt: addHours(NOW, 72),
    escalatedAt: null,
    resolvedAt: null,
    closedAt: null,
    outcomeReason: null,
    lastReporterVisibleAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const JOVAN: Principal = {
  userId: 'user_jovan',
  context: { kind: 'personal', orgId: ORG },
  staffTemplates: [],
} as unknown as Principal;
const IVANA: Principal = { userId: 'user_ivana', context: { kind: 'organization', orgId: ORG }, staffTemplates: [] } as unknown as Principal;

function makeService(overrides: { state?: CaseRow['state']; eligible?: (userId: string) => boolean } = {}) {
  const tx = { tag: 'tx' };
  let stored = caseRow(overrides.state ? { state: overrides.state } : {});
  const repo = {
    findRoute: vi.fn().mockResolvedValue(ROUTE),
    listRoutes: vi.fn().mockResolvedValue([ROUTE]),
    insertCase: vi.fn().mockImplementation(async (values: Partial<CaseRow>) => {
      stored = caseRow({ ...values, id: 'case_new' });
      return stored;
    }),
    insertReporter: vi.fn().mockResolvedValue(undefined),
    insertMessage: vi.fn().mockResolvedValue({}),
    insertAssignment: vi.fn().mockResolvedValue(undefined),
    endAssignments: vi.fn().mockResolvedValue(undefined),
    findCase: vi.fn().mockImplementation(async () => stored),
    lockCase: vi.fn().mockImplementation(async () => stored),
    updateCase: vi.fn().mockImplementation(async (_id: string, patch: Partial<CaseRow>) => {
      stored = { ...stored, ...patch };
      return stored;
    }),
    findReporterUserId: vi.fn().mockResolvedValue('user_jovan'),
    listMessages: vi.fn().mockResolvedValue([]),
    lastVisibleMessageAt: vi.fn().mockResolvedValue(new Map()),
    listCasesOfReporter: vi.fn().mockResolvedValue([]),
    listCasesByIds: vi.fn().mockResolvedValue([]),
  };
  const routes = {
    handlerEligible: vi.fn().mockImplementation(async (userId: string) => (overrides.eligible ? overrides.eligible(userId) : true)),
    displayNames: vi.fn().mockResolvedValue(new Map()),
  };
  const authz = { require: vi.fn().mockResolvedValue(undefined), allows: vi.fn().mockResolvedValue(true) };
  const authzRepo = { findActiveAssignments: vi.fn().mockResolvedValue([]) };
  const configuration = { isEnabled: vi.fn().mockResolvedValue(true), find: vi.fn().mockResolvedValue({ feedbackSensitiveEnabled: false }) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const principals = { invalidateUser: vi.fn().mockResolvedValue(undefined) };
  const notifier = { assigned: vi.fn().mockResolvedValue(true), updateForReporter: vi.fn().mockResolvedValue(true), updateForHandler: vi.fn().mockResolvedValue(true) };
  const dbs = { withOrgScope: vi.fn().mockImplementation(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const service = new FeedbackCasesService(
    dbs as never,
    repo as never,
    routes as unknown as FeedbackRoutesService,
    authz as never,
    authzRepo as never,
    configuration as never,
    audit as never,
    principals as never,
    notifier as never,
  );
  return { service, repo, routes, authz, audit, principals, notifier, configuration, stored: () => stored };
}

describe('FeedbackCasesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create through the alternate route assigns and notifies the alternate only, with an actor-less audit row', async () => {
    const { service, repo, audit, notifier, principals } = makeService();
    const res = await service.create(JOVAN, { routeId: ROUTE.id, kind: 'problem', category: 'workload', routeChoice: 'alternate', anonymousToEmployer: true, body: 'The rota changes without notice.' }, NOW);
    expect(res.handlerFunction).toBe('alternate');
    expect(res.pseudonym).toMatch(/^Reporter-[A-Z2-7]{4}$/);
    expect(res.dueAt).toBe(addHours(NOW, 72).toISOString());
    expect(repo.insertAssignment).toHaveBeenCalledTimes(1);
    expect(repo.insertAssignment.mock.calls[0]![0]).toMatchObject({ userId: 'user_ivana', targetId: 'case_new' });
    expect(repo.insertReporter).toHaveBeenCalledWith({ caseId: 'case_new', orgId: ORG, reporterUserId: 'user_jovan' }, expect.anything());
    expect(notifier.assigned).toHaveBeenCalledTimes(1);
    expect(notifier.assigned.mock.calls[0]![1]).toBe('user_ivana');
    expect(principals.invalidateUser).toHaveBeenCalledWith('user_ivana', [ORG]);
    const created = audit.record.mock.calls.find((c) => c[0].action === 'feedback_case.created')![0];
    expect(created).toMatchObject({ actorUserId: null, actorKind: 'SYSTEM' });
    expect(JSON.stringify(created.details)).not.toMatch(/user_jovan|rota/);
  });

  it('create refuses a route whose chosen recipient is no longer eligible', async () => {
    const { service, repo } = makeService({ eligible: (userId) => userId !== 'user_stefan' });
    await expect(
      service.create(JOVAN, { routeId: ROUTE.id, kind: 'suggestion', category: 'other', routeChoice: 'primary', anonymousToEmployer: true, body: 'x' }, NOW),
    ).rejects.toMatchObject({ code: 'route_unavailable' });
    expect(repo.insertCase).not.toHaveBeenCalled();
  });

  it('resolving without an explanation is a 400 validation error naming the field', async () => {
    const { service, repo } = makeService({ state: 'in_review' });
    const err = await service.setState(IVANA, 'case_1', { state: 'resolved' }, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpException);
    expect((err as ApiHttpException).getStatus()).toBe(400);
    expect((err as ApiHttpException).details).toEqual({ field: 'reporterExplanation' });
    expect(repo.updateCase).not.toHaveBeenCalled();
  });

  it('resolving with an explanation posts it as a reporter-visible message and clears the due target', async () => {
    const { service, repo, notifier } = makeService({ state: 'action_in_progress' });
    const view = await service.setState(IVANA, 'case_1', { state: 'resolved', reporterExplanation: 'We changed the rota process.' }, NOW);
    expect(view.state).toBe('resolved');
    expect(view.dueAt).toBeNull();
    expect(repo.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ sender: 'handler', internal: false, body: 'We changed the rota process.' }), expect.anything());
    expect(notifier.updateForReporter).toHaveBeenCalledTimes(1);
  });

  it('refuses a transition the state machine does not allow', async () => {
    const { service } = makeService({ state: 'submitted' });
    await expect(service.setState(IVANA, 'case_1', { state: 'closed', outcomeReason: 'done' }, NOW)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('a reporter reply on a resolved case reopens it to in_review with a fresh due target', async () => {
    const { service, stored, notifier } = makeService({ state: 'resolved' });
    const view = await service.replyMine(JOVAN, 'case_1', { body: 'It is still happening.' }, NOW);
    expect(view.state).toBe('in_review');
    expect(stored().nextAction).toBe('review_reply');
    expect(stored().dueAt?.toISOString()).toBe(addHours(NOW, 72).toISOString());
    expect(view.handlerFunction).toBe('alternate');
    expect(JSON.stringify(view)).not.toContain('user_ivana');
    expect(notifier.updateForHandler).toHaveBeenCalledTimes(1);
  });

  it('a reporter reply on a closed case is refused', async () => {
    const { service } = makeService({ state: 'closed' });
    await expect(service.replyMine(JOVAN, 'case_1', { body: 'x' }, NOW)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('reassigning to the recipient who already holds the case is a conflict, and the handler path never reads the reporter link', async () => {
    const { service, repo } = makeService({ state: 'in_review' });
    await expect(service.reassign(IVANA, 'case_1', { to: 'alternate' }, NOW)).rejects.toMatchObject({ code: 'same_handler' });
    await service.readAssigned(IVANA, 'case_1');
    expect(repo.findReporterUserId).not.toHaveBeenCalled();
  });

  it('defaultNextAction names an owned step for every open state and none for the rest', () => {
    expect(defaultNextAction('submitted')).toBe('acknowledge');
    expect(defaultNextAction('in_review')).toBe('respond');
    expect(defaultNextAction('waiting_for_reporter')).toBe('await_reporter');
    expect(defaultNextAction('action_in_progress')).toBe('complete_action');
    expect(defaultNextAction('resolved')).toBeNull();
    expect(defaultNextAction('closed')).toBeNull();
  });
});

describe('FeedbackRoutesService.validateRoute', () => {
  it('refuses the same person as primary and alternate before anything else', async () => {
    const service = new FeedbackRoutesService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(
      service.validateRoute({ kind: 'standard', categories: ['other'], primaryHandlerUserId: 'u1', alternateHandlerUserId: 'u1', enabled: false, responseTargetHours: 72 }, ORG, false, NOW),
    ).rejects.toMatchObject({ code: 'same_handler' });
  });

  it('requires NestSelf to have enabled the sensitive route and a staffed process', async () => {
    const memberships = { findActiveByUserAndOrg: vi.fn().mockResolvedValue({ id: 'm' }) };
    const authzRepo = { findGrantsForOrg: vi.fn().mockResolvedValue([{ actions: ['feedback_case.handle'], validFrom: new Date('2026-01-01T00:00:00Z'), validUntil: null }]) };
    const service = new FeedbackRoutesService({} as never, {} as never, authzRepo as never, memberships as never, {} as never, {} as never, {} as never);
    const route = { kind: 'sensitive' as const, categories: ['safety'], primaryHandlerUserId: 'u1', alternateHandlerUserId: 'u2', enabled: true, responseTargetHours: 24 };
    await expect(service.validateRoute(route, ORG, false, NOW)).rejects.toMatchObject({ code: 'sensitive_not_enabled' });
    await expect(service.validateRoute(route, ORG, true, NOW)).rejects.toMatchObject({ code: 'validation', details: { field: 'operatingHours' } });
    await expect(service.validateRoute({ ...route, operatingHours: 'Mon-Fri 9-17', escalationNote: 'Call the ethics line' }, ORG, true, NOW)).resolves.toBeUndefined();
  });
});
