/**
 * FeedbackCasesService: the employee's own cases and the handler's assigned
 * cases (spec FBK-01..05; ADR 0002, D-EL-01 and D-EL-06).
 *
 * Two paths never meet:
 * - The reporter path runs in the personal context's organization, loads the
 *   restricted reporter link to check ownership (`own` scope) and returns the
 *   reporter view (visible messages only, a function instead of a handler).
 * - The handler path runs in the organization context, is authorized through
 *   the CASE assignment on the case (`assigned_cases` scope, confidential
 *   resource, every denial a 404) and returns the handler view, which has no
 *   reporter field to fill. It never selects from `feedback_case_reporters`.
 *
 * Audit rows written on the reporter's behalf carry no actor; no row and no
 * log line names the reporter (spec PRI-03, PRI-04).
 */
import { Injectable } from '@nestjs/common';
import {
  ACTIONS,
  FEEDBACK_OPEN_STATES,
  canTransition,
  type Action,
  type FeedbackCaseCreateRequest,
  type FeedbackCaseCreateResponse,
  type FeedbackCaseState,
  type FeedbackMessageRequest,
  type FeedbackReassignRequest,
  type FeedbackReporterMessageRequest,
  type FeedbackRouteKind,
  type FeedbackRoutesResponse,
  type FeedbackStateRequest,
  type HandlerFeedbackCaseResponse,
  type HandlerFeedbackInboxResponse,
  type MyFeedbackCaseResponse,
  type MyFeedbackCasesResponse,
  type Principal,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningConfigurationService } from '../listening/listening-configuration.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
import { caseResource } from './feedback-case.resolver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FEEDBACK_ASSIGNMENT_REASON, FeedbackCasesRepository, type CaseRow, type RouteRow } from './feedback-cases.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackNotifier } from './feedback-notifier.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackRoutesService, conflict, validationError } from './feedback-routes.service.js';
import { toHandlerSummary, toHandlerView, toMySummary, toReporterView, toRouteView } from './feedback-views.js';
import { casePseudonym } from './pseudonym.js';

/** Passed to every single-record check: a denial must look exactly like a missing case. */
const DENY_AS_NOT_FOUND = { denyAs: 'not_found' } as const;

export function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

function invalidContext(message: string): ApiHttpException {
  return new ApiHttpException({ status: 403, code: 'invalid_context', message });
}

/** The organization of the caller's personal context (the employee routes). */
export function personalOrgId(principal: Principal): string {
  const ctx = principal.context;
  if (ctx.kind !== 'personal' || !ctx.orgId) throw invalidContext('This endpoint requires a personal context with an organisation');
  return ctx.orgId;
}

/** The organization of the caller's organization context (the handler routes). */
export function organizationOrgId(principal: Principal): string {
  const ctx = principal.context;
  if (ctx.kind !== 'organization' || !ctx.orgId) throw invalidContext('This endpoint requires an organization context');
  return ctx.orgId;
}

export function addHours(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * 3_600_000);
}

/** The next action a state implies when the handler names none (spec FBK-04). */
export function defaultNextAction(state: FeedbackCaseState): string | null {
  switch (state) {
    case 'submitted':
      return 'acknowledge';
    case 'in_review':
      return 'respond';
    case 'waiting_for_reporter':
      return 'await_reporter';
    case 'action_in_progress':
      return 'complete_action';
    default:
      return null;
  }
}

@Injectable()
export class FeedbackCasesService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: FeedbackCasesRepository,
    private readonly routes: FeedbackRoutesService,
    private readonly authz: AuthorizationService,
    private readonly authzRepo: AuthorizationRepository,
    private readonly configuration: ListeningConfigurationService,
    private readonly audit: AuditWriter,
    private readonly principals: PrincipalLoader,
    private readonly notifier: FeedbackNotifier,
  ) {}

  // ── Employee: routes and creation (FBK-01, FBK-03) ───────────────────────

  async routesForEmployee(principal: Principal, now = new Date()): Promise<FeedbackRoutesResponse> {
    const orgId = personalOrgId(principal);
    const feedbackEnabled = await this.configuration.isEnabled(orgId, 'feedback', now);
    const config = feedbackEnabled ? await this.configuration.find(orgId) : null;
    const sensitiveEnabled = feedbackEnabled && (config?.feedbackSensitiveEnabled ?? false);
    const rows = feedbackEnabled ? await this.dbs.withOrgScope(orgId, (tx) => this.repo.listRoutes(orgId, tx)) : [];
    const visible = rows.filter((r) => r.enabled && (r.kind === 'standard' || sensitiveEnabled));
    const names = await this.routes.displayNames(visible.flatMap((r) => [r.primaryHandlerUserId, r.alternateHandlerUserId]));
    return { feedbackEnabled, sensitiveEnabled, items: visible.map((r) => toRouteView(r, names)) };
  }

  async create(principal: Principal, body: FeedbackCaseCreateRequest, now = new Date()): Promise<FeedbackCaseCreateResponse> {
    const orgId = personalOrgId(principal);
    if (!(await this.configuration.isEnabled(orgId, 'feedback', now))) throw conflict('feedback_disabled', 'The feedback channel is not enabled for this organization');
    const result = await this.dbs.withOrgScope(orgId, async (tx) => {
      const route = await this.repo.findRoute(body.routeId, tx);
      if (!route || route.orgId !== orgId || !route.enabled) throw conflict('route_unavailable', 'This route is not available');
      if (route.kind === 'sensitive') {
        const config = await this.configuration.find(orgId);
        if (!config?.feedbackSensitiveEnabled) throw conflict('sensitive_not_enabled', 'The sensitive route is not enabled for this organization');
      }
      const handlerUserId = body.routeChoice === 'primary' ? route.primaryHandlerUserId : route.alternateHandlerUserId;
      // The chosen recipient must still be able to receive it; the UI never reports success into an unowned inbox (spec FBK-03).
      if (!(await this.routes.handlerEligible(handlerUserId, orgId, now, tx))) {
        throw conflict('route_unavailable', 'The chosen recipient is not available', { handler: body.routeChoice });
      }
      const row = await this.repo.insertCase(
        {
          orgId,
          routeId: route.id,
          kind: body.kind,
          category: body.category,
          anonymousToEmployer: body.anonymousToEmployer,
          pseudonym: casePseudonym(),
          state: 'submitted',
          routeChoice: body.routeChoice,
          handlerUserId,
          nextAction: defaultNextAction('submitted'),
          dueAt: addHours(now, route.responseTargetHours),
          lastReporterVisibleAt: now,
        },
        tx,
      );
      await this.repo.insertReporter({ caseId: row.id, orgId, reporterUserId: principal.userId }, tx);
      await this.repo.insertMessage({ caseId: row.id, orgId, sender: 'reporter', authorUserId: null, body: body.body, internal: false }, tx);
      // The chosen handler only: the other recipient gets neither the case nor a notification (spec FBK-03).
      await this.repo.insertAssignment({ userId: handlerUserId, targetId: row.id, assignedByUserId: handlerUserId, startAt: now }, tx);
      await this.audit.record(
        {
          action: 'feedback_case.created',
          actorUserId: null,
          actorKind: 'SYSTEM',
          orgId,
          recordType: 'feedback_case',
          recordId: row.id,
          result: 'ALLOWED',
          details: { routeKind: route.kind, routeChoice: body.routeChoice, kind: body.kind, category: body.category },
        },
        { tx },
      );
      return { row, handlerUserId };
    });
    await this.principals.invalidateUser(result.handlerUserId, [orgId]);
    await this.notifier.assigned(result.row, result.handlerUserId);
    return { id: result.row.id, pseudonym: result.row.pseudonym, state: result.row.state, dueAt: result.row.dueAt?.toISOString() ?? null, handlerFunction: body.routeChoice };
  }

  // ── Employee: own cases (FBK-02) ─────────────────────────────────────────

  async listMine(principal: Principal): Promise<MyFeedbackCasesResponse> {
    const orgId = personalOrgId(principal);
    return this.dbs.withOrgScope(orgId, async (tx) => {
      const rows = await this.repo.listCasesOfReporter(principal.userId, orgId, tx);
      const last = await this.repo.lastVisibleMessageAt(
        rows.map((r) => r.id),
        tx,
      );
      return { items: rows.map((r) => toMySummary(r, last.get(r.id) ?? null)) };
    });
  }

  async readMine(principal: Principal, id: string): Promise<MyFeedbackCaseResponse> {
    const { row, route, orgId } = await this.loadOwn(principal, id, ACTIONS['feedback_case.read.self']);
    const messages = await this.dbs.withOrgScope(orgId, (tx) => this.repo.listMessages(id, { includeInternal: false }, tx));
    return toReporterView(row, route.kind as FeedbackRouteKind, messages);
  }

  /**
   * A reporter's reply or clarification request. On a resolved or waiting
   * case it reopens the case into an owned state with a fresh target (spec
   * FBK-04: "returns it to an owned active state"); it is never dropped.
   */
  async replyMine(principal: Principal, id: string, body: FeedbackReporterMessageRequest, now = new Date()): Promise<MyFeedbackCaseResponse> {
    const { route, orgId } = await this.loadOwn(principal, id, ACTIONS['feedback_case.reply.self']);
    const updated = await this.dbs.withOrgScope(orgId, async (tx) => {
      const locked = await this.repo.lockCase(id, tx);
      if (!locked) throw notFound();
      if (locked.state === 'closed') throw conflict('invalid_state', 'A closed case accepts no replies');
      await this.repo.insertMessage({ caseId: id, orgId, sender: 'reporter', authorUserId: null, body: body.body, internal: false }, tx);
      const reopen = locked.state === 'resolved' || locked.state === 'waiting_for_reporter';
      const next = await this.repo.updateCase(
        id,
        reopen
          ? { state: 'in_review', nextAction: 'review_reply', dueAt: addHours(now, route.responseTargetHours), resolvedAt: null, escalatedAt: null, lastReporterVisibleAt: now }
          : { lastReporterVisibleAt: now },
        tx,
      );
      await this.audit.record(
        {
          action: 'feedback_case.reporter_replied',
          actorUserId: null,
          actorKind: 'SYSTEM',
          orgId,
          recordType: 'feedback_case',
          recordId: id,
          result: 'ALLOWED',
          details: { fromState: locked.state, toState: next.state, reopened: reopen },
        },
        { tx },
      );
      return next;
    });
    if (updated.handlerUserId) await this.notifier.updateForHandler(updated, updated.handlerUserId);
    const messages = await this.dbs.withOrgScope(orgId, (tx) => this.repo.listMessages(id, { includeInternal: false }, tx));
    return toReporterView(updated, route.kind as FeedbackRouteKind, messages);
  }

  /** The reporter's own case: the restricted link decides ownership; a stranger gets the same 404 as a missing case. */
  private async loadOwn(principal: Principal, id: string, action: Action): Promise<{ row: CaseRow; route: RouteRow; orgId: string }> {
    const orgId = personalOrgId(principal);
    const found = await this.dbs.withOrgScope(orgId, async (tx) => {
      const row = await this.repo.findCase(id, tx);
      if (!row) return null;
      const [reporterUserId, route] = await Promise.all([this.repo.findReporterUserId(id, tx), this.repo.findRoute(row.routeId, tx)]);
      return route ? { row, reporterUserId, route } : null;
    });
    if (!found || !found.reporterUserId) throw notFound();
    await this.authz.require(
      principal,
      action,
      { type: 'feedback_case', id, orgId, ownerId: found.reporterUserId, isConfidential: true },
      DENY_AS_NOT_FOUND,
    );
    return { row: found.row, route: found.route, orgId };
  }

  // ── Handler (FBK-02, FBK-04) ─────────────────────────────────────────────

  /** The caller's assigned cases in the organization, each re-checked against the handler grant. */
  async inbox(principal: Principal, now = new Date()): Promise<HandlerFeedbackInboxResponse> {
    const orgId = organizationOrgId(principal);
    const assigned = await this.authzRepo.findActiveAssignments(principal.userId, now);
    const ids = [...new Set(assigned.filter((a) => a.kind === 'CASE' && a.reason === FEEDBACK_ASSIGNMENT_REASON).map((a) => a.targetId))];
    if (ids.length === 0) return { items: [] };
    const { rows, routes, last } = await this.dbs.withOrgScope(orgId, async (tx) => {
      const rows = await this.repo.listCasesByIds(ids, tx);
      const routes = new Map((await this.repo.listRoutes(orgId, tx)).map((r) => [r.id, r]));
      const last = await this.repo.lastVisibleMessageAt(
        rows.map((r) => r.id),
        tx,
      );
      return { rows, routes, last };
    });
    const items = [];
    for (const row of rows) {
      if (!(await this.authz.allows(principal, ACTIONS['feedback_case.handle'], caseResource(row)))) continue;
      items.push(toHandlerSummary(row, (routes.get(row.routeId)?.kind ?? 'standard') as FeedbackRouteKind, last.get(row.id) ?? null, now));
    }
    return { items };
  }

  async readAssigned(principal: Principal, id: string): Promise<HandlerFeedbackCaseResponse> {
    const { row, route, orgId } = await this.loadAssigned(principal, id, ACTIONS['feedback_case.handle']);
    const messages = await this.dbs.withOrgScope(orgId, (tx) => this.repo.listMessages(id, { includeInternal: true }, tx));
    await this.audit.record({ action: 'feedback_case.read', actorUserId: principal.userId, actorKind: 'USER', orgId, recordType: 'feedback_case', recordId: id, result: 'ALLOWED' });
    return toHandlerView(row, route.kind as FeedbackRouteKind, messages);
  }

  /** A handler's reply (reporter-visible) or internal note; a first visible reply moves a submitted case into review. */
  async postHandlerMessage(principal: Principal, id: string, body: FeedbackMessageRequest, now = new Date()): Promise<HandlerFeedbackCaseResponse> {
    const { route, orgId } = await this.loadAssigned(principal, id, ACTIONS['feedback_case.handle']);
    const updated = await this.dbs.withOrgScope(orgId, async (tx) => {
      const locked = await this.repo.lockCase(id, tx);
      if (!locked) throw notFound();
      if (locked.state === 'closed') throw conflict('invalid_state', 'A closed case accepts no messages');
      await this.repo.insertMessage({ caseId: id, orgId, sender: 'handler', authorUserId: principal.userId, body: body.body, internal: body.internal }, tx);
      let next = locked;
      if (!body.internal) {
        next = await this.repo.updateCase(
          id,
          locked.state === 'submitted'
            ? { state: 'in_review', nextAction: defaultNextAction('in_review'), lastReporterVisibleAt: now }
            : { lastReporterVisibleAt: now },
          tx,
        );
      }
      await this.audit.record(
        {
          action: 'feedback_case.message_sent',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'feedback_case',
          recordId: id,
          result: 'ALLOWED',
          details: { internal: body.internal, fromState: locked.state, toState: next.state },
        },
        { tx },
      );
      return next;
    });
    if (!body.internal) await this.notifier.updateForReporter(updated);
    return this.handlerView(updated, route, orgId);
  }

  /** A state change per the state machine; resolving needs a reporter-facing explanation, closing an outcome reason (spec FBK-04). */
  async setState(principal: Principal, id: string, body: FeedbackStateRequest, now = new Date()): Promise<HandlerFeedbackCaseResponse> {
    if (body.state === 'resolved' && !body.reporterExplanation) throw validationError('A reporter-facing explanation is required to resolve a case', 'reporterExplanation');
    if (body.state === 'closed' && !body.outcomeReason) throw validationError('An outcome reason is required to close a case', 'outcomeReason');
    const { route, orgId } = await this.loadAssigned(principal, id, ACTIONS['feedback_case.handle']);
    const updated = await this.dbs.withOrgScope(orgId, async (tx) => {
      const locked = await this.repo.lockCase(id, tx);
      if (!locked) throw notFound();
      if (!canTransition(locked.state, body.state)) throw conflict('invalid_state', `A case cannot move from ${locked.state} to ${body.state}`, { from: locked.state, to: body.state });
      const patch: Partial<CaseRow> = { state: body.state, nextAction: body.nextAction ?? defaultNextAction(body.state) };
      if (body.state === 'in_review' || body.state === 'action_in_progress') {
        patch.dueAt = addHours(now, route.responseTargetHours);
        patch.resolvedAt = null;
      }
      if (body.state === 'resolved') {
        patch.resolvedAt = now;
        patch.dueAt = null;
        patch.lastReporterVisibleAt = now;
        await this.repo.insertMessage({ caseId: id, orgId, sender: 'handler', authorUserId: principal.userId, body: body.reporterExplanation!, internal: false }, tx);
      }
      if (body.state === 'closed') {
        patch.closedAt = now;
        patch.dueAt = null;
        patch.outcomeReason = body.outcomeReason!;
      }
      const next = await this.repo.updateCase(id, patch, tx);
      await this.audit.record(
        {
          action: 'feedback_case.state_changed',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'feedback_case',
          recordId: id,
          result: 'ALLOWED',
          details: { fromState: locked.state, toState: next.state, hasOutcomeReason: body.outcomeReason !== undefined },
        },
        { tx },
      );
      return next;
    });
    if (body.state === 'resolved' || body.state === 'waiting_for_reporter') await this.notifier.updateForReporter(updated);
    return this.handlerView(updated, route, orgId);
  }

  /** Moves the case to the route's other recipient; the target must be eligible, and only the target is notified (spec FBK-03). */
  async reassign(principal: Principal, id: string, body: FeedbackReassignRequest, now = new Date()): Promise<HandlerFeedbackCaseResponse> {
    const { route, orgId } = await this.loadAssigned(principal, id, ACTIONS['feedback_case.assign']);
    const result = await this.dbs.withOrgScope(orgId, async (tx) => {
      const locked = await this.repo.lockCase(id, tx);
      if (!locked) throw notFound();
      if (!FEEDBACK_OPEN_STATES.includes(locked.state)) throw conflict('invalid_state', 'Only an open case can be reassigned');
      const target = body.to === 'primary' ? route.primaryHandlerUserId : route.alternateHandlerUserId;
      if (target === locked.handlerUserId) throw conflict('same_handler', 'The case is already with this recipient');
      if (!(await this.routes.handlerEligible(target, orgId, now, tx))) throw conflict('handler_not_eligible', 'The recipient is not an active member holding the feedback handler grant');
      if (locked.handlerUserId) await this.repo.endAssignments(id, locked.handlerUserId, now, tx);
      await this.repo.insertAssignment({ userId: target, targetId: id, assignedByUserId: principal.userId, startAt: now }, tx);
      const next = await this.repo.updateCase(id, { handlerUserId: target, routeChoice: body.to, escalatedAt: null }, tx);
      await this.audit.record(
        {
          action: 'feedback_case.reassigned',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'feedback_case',
          recordId: id,
          result: 'ALLOWED',
          details: { to: body.to, fromState: locked.state },
        },
        { tx },
      );
      return { next, previous: locked.handlerUserId, target };
    });
    await Promise.all([this.principals.invalidateUser(result.target, [orgId]), result.previous ? this.principals.invalidateUser(result.previous, [orgId]) : Promise.resolve()]);
    await this.notifier.assigned(result.next, result.target);
    return this.handlerView(result.next, route, orgId);
  }

  private async handlerView(row: CaseRow, route: RouteRow, orgId: string): Promise<HandlerFeedbackCaseResponse> {
    const messages = await this.dbs.withOrgScope(orgId, (tx) => this.repo.listMessages(row.id, { includeInternal: true }, tx));
    return toHandlerView(row, route.kind as FeedbackRouteKind, messages);
  }

  /** The case in the caller's organization, authorized through the CASE assignment; never touches the reporter link. */
  private async loadAssigned(principal: Principal, id: string, action: Action): Promise<{ row: CaseRow; route: RouteRow; orgId: string }> {
    const orgId = organizationOrgId(principal);
    const found = await this.dbs.withOrgScope(orgId, async (tx) => {
      const row = await this.repo.findCase(id, tx);
      if (!row) return null;
      const route = await this.repo.findRoute(row.routeId, tx);
      return route ? { row, route } : null;
    });
    if (!found) throw notFound();
    await this.authz.require(principal, action, caseResource(found.row), DENY_AS_NOT_FOUND);
    return { ...found, orgId };
  }
}

export type { DbExecutor };
