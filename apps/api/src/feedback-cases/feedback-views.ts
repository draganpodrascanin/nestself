/**
 * The allowlist mappers of the feedback module: the only way a row leaves the
 * service. Each copies named fields into a fresh object, so a row that
 * happens to carry more (a joined reporter column, say) cannot reach a
 * response (spec FBK-02, PRI-03). The contracts' `strictObject`s are the
 * second line of defense.
 */
import type {
  FeedbackMessageView,
  FeedbackRouteAdmin,
  FeedbackRouteChoice,
  FeedbackRouteKind,
  FeedbackRouteView,
  HandlerFeedbackCaseResponse,
  HandlerFeedbackCaseSummary,
  MyFeedbackCaseResponse,
  MyFeedbackCaseSummary,
} from '@nestself/contracts';
import type { CaseRow, MessageRow, RouteRow } from './feedback-cases.repository.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export type DisplayNames = ReadonlyMap<string, string>;

const nameOf = (names: DisplayNames, userId: string): string => names.get(userId) ?? 'Designated recipient';

export function toRouteView(row: RouteRow, names: DisplayNames): FeedbackRouteView {
  return {
    id: row.id,
    kind: row.kind as FeedbackRouteKind,
    categories: [...row.categories],
    primary: { displayName: nameOf(names, row.primaryHandlerUserId), functionLabel: 'primary' },
    alternate: { displayName: nameOf(names, row.alternateHandlerUserId), functionLabel: 'alternate' },
    enabled: row.enabled,
    operatingHours: row.operatingHours,
    responseTargetHours: row.responseTargetHours,
  };
}

export function toRouteAdmin(row: RouteRow, names: DisplayNames): FeedbackRouteAdmin {
  return {
    id: row.id,
    kind: row.kind as FeedbackRouteKind,
    categories: [...row.categories],
    primaryHandlerUserId: row.primaryHandlerUserId,
    primaryDisplayName: nameOf(names, row.primaryHandlerUserId),
    alternateHandlerUserId: row.alternateHandlerUserId,
    alternateDisplayName: nameOf(names, row.alternateHandlerUserId),
    enabled: row.enabled,
    operatingHours: row.operatingHours,
    responseTargetHours: row.responseTargetHours,
    escalationNote: row.escalationNote,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessageView(row: MessageRow): FeedbackMessageView {
  return { id: row.id, sender: row.sender, body: row.body, createdAt: row.createdAt.toISOString(), internal: row.internal };
}

/** The reporter's thread: internal notes never pass, whatever the caller loaded. */
export function reporterVisible(messages: readonly MessageRow[]): FeedbackMessageView[] {
  return messages.filter((m) => !m.internal).map(toMessageView);
}

export function toMySummary(row: CaseRow, lastMessageAt: Date | null): MyFeedbackCaseSummary {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    state: row.state,
    pseudonym: row.pseudonym,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: iso(lastMessageAt),
    dueAt: iso(row.dueAt),
  };
}

export function toReporterView(row: CaseRow, routeKind: FeedbackRouteKind, messages: readonly MessageRow[]): MyFeedbackCaseResponse {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    state: row.state,
    pseudonym: row.pseudonym,
    createdAt: row.createdAt.toISOString(),
    dueAt: iso(row.dueAt),
    handlerFunction: row.routeChoice as FeedbackRouteChoice,
    routeKind,
    messages: reporterVisible(messages),
  };
}

export function toHandlerSummary(row: CaseRow, routeKind: FeedbackRouteKind, lastMessageAt: Date | null, now: Date): HandlerFeedbackCaseSummary {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    state: row.state,
    pseudonym: row.pseudonym,
    routeKind,
    routeChoice: row.routeChoice as FeedbackRouteChoice,
    nextAction: row.nextAction,
    dueAt: iso(row.dueAt),
    overdue: row.dueAt !== null && row.dueAt.getTime() < now.getTime() && row.state !== 'resolved' && row.state !== 'closed',
    escalatedAt: iso(row.escalatedAt),
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: iso(lastMessageAt),
  };
}

/**
 * The handler's view. Takes the row as a plain record so a test can hand it
 * one with a `reporterUserId` and prove the property never comes out.
 */
export function toHandlerView(row: CaseRow, routeKind: FeedbackRouteKind, messages: readonly MessageRow[]): HandlerFeedbackCaseResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    kind: row.kind,
    category: row.category,
    state: row.state,
    pseudonym: row.pseudonym,
    anonymousToEmployer: row.anonymousToEmployer,
    routeKind,
    routeChoice: row.routeChoice as FeedbackRouteChoice,
    handlerUserId: row.handlerUserId,
    nextAction: row.nextAction,
    dueAt: iso(row.dueAt),
    escalatedAt: iso(row.escalatedAt),
    resolvedAt: iso(row.resolvedAt),
    closedAt: iso(row.closedAt),
    outcomeReason: row.outcomeReason,
    createdAt: row.createdAt.toISOString(),
    messages: messages.map(toMessageView),
  };
}
