/**
 * ProfessionalService: reads of the confidential professional-interaction
 * domain (T-2.4, section 4.7). Each method loads the row, builds the
 * confidential resource from it and calls `AuthorizationService.require`
 * before reading or returning any content; a denial is audited there as
 * `access.denied` with identifiers only. Message bodies and intake text are
 * never logged or written to audit details.
 *
 * The two list routes return metadata only (no message body). Candidate
 * rows come from the caller's current CASE / SUPPORT_CASE assignments
 * (expert list) or from `employeeUserId = caller` (participant list); each
 * row is then kept only when `authorize()` allows the same action the
 * single-record read requires, so a revoked grant empties the list too.
 * List filtering is neither audited nor step-up gated: it reveals no content.
 * Lists are keyset-paged; `nextCursor` comes from the last fetched row, so a
 * page thinned by authorization still pages on.
 *
 * Emergency reads (`records.read.emergency`) live in the emergency module
 * and share `professional-records.ts`.
 */
import { Injectable } from '@nestjs/common';
import type {
  Action,
  ConversationListQuery,
  ConversationListResponse,
  ConversationSummary,
  Principal,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  ProfessionalRepository,
  type ConversationSummaryRow,
} from '../db/repositories/professional.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
import { ApiHttpException } from '../common/api-error.js';
import {
  confidentialResource,
  toConversationView,
  toIntakeView,
  type ConversationView,
  type IntakeView,
} from './professional-records.js';

export type { ConversationView, IntakeView } from './professional-records.js';

/** Assignment kinds whose target is a case (`assigned_cases` scope, section 4.5.4). */
const CASE_ASSIGNMENT_KINDS: ReadonlySet<string> = new Set(['CASE', 'SUPPORT_CASE']);

function toSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    caseId: row.caseId,
    orgId: row.orgId,
    employeeUserId: row.employeeUserId,
    expertUserId: row.expertUserId,
    createdAt: row.createdAt.toISOString(),
    messageCount: row.messageCount,
  };
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

@Injectable()
export class ProfessionalService {
  constructor(
    private readonly repo: ProfessionalRepository,
    private readonly authz: AuthorizationService,
    private readonly authzRepo: AuthorizationRepository,
  ) {}

  /** Conversations of the cases the caller is currently assigned to (metadata only). */
  async listAssignedConversations(
    principal: Principal,
    query: ConversationListQuery,
  ): Promise<ConversationListResponse> {
    const assignments = await this.authzRepo.findActiveAssignments(principal.userId, new Date());
    const caseIds = [
      ...new Set(assignments.filter((a) => CASE_ASSIGNMENT_KINDS.has(a.kind)).map((a) => a.targetId)),
    ];
    const rows = await this.repo.listConversationsByCaseIds(caseIds, { limit: query.limit, cursor: query.cursor });
    return this.page(principal, 'conversation.read.assigned', rows, query.limit);
  }

  /** Conversations in which the caller is the employee participant (metadata only). */
  async listOwnConversations(principal: Principal, query: ConversationListQuery): Promise<ConversationListResponse> {
    const rows = await this.repo.listConversationsByEmployee(principal.userId, {
      limit: query.limit,
      cursor: query.cursor,
    });
    return this.page(principal, 'conversation.participate', rows, query.limit);
  }

  /** Assigned-expert path: a current CASE assignment on the conversation's case. */
  readAssignedConversation(principal: Principal, id: string): Promise<ConversationView> {
    return this.readConversation(principal, id, 'conversation.read.assigned');
  }

  /** Participant path: the employee whose conversation it is. */
  readOwnConversation(principal: Principal, id: string): Promise<ConversationView> {
    return this.readConversation(principal, id, 'conversation.participate');
  }

  /** Assigned-expert path for the intake record of a case. */
  async readAssignedIntake(principal: Principal, id: string): Promise<IntakeView> {
    const row = await this.repo.findIntake(id);
    if (!row) throw notFound();
    await this.authz.require(principal, 'conversation.read.assigned', confidentialResource('intake', row));
    return toIntakeView(row);
  }

  /**
   * Cut the `limit + 1` fetch to one page, then keep the rows `authorize()`
   * allows. Rows are evaluated one after another, and once per distinct
   * resource, so a page never fans out into parallel context loads.
   */
  private async page(
    principal: Principal,
    action: Action,
    rows: ConversationSummaryRow[],
    limit: number,
  ): Promise<ConversationListResponse> {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const decisions = new Map<string, boolean>();
    const items: ConversationSummary[] = [];
    for (const row of pageRows) {
      const key = JSON.stringify([row.orgId, row.caseId, row.employeeUserId]);
      let allowed = decisions.get(key);
      if (allowed === undefined) {
        allowed = await this.authz.allows(principal, action, confidentialResource('conversation', row));
        decisions.set(key, allowed);
      }
      if (allowed) items.push(toSummary(row));
    }
    return { items, nextCursor: hasMore ? pageRows[pageRows.length - 1]!.id : null };
  }

  private async readConversation(principal: Principal, id: string, action: Action): Promise<ConversationView> {
    const row = await this.repo.findConversation(id);
    if (!row) throw notFound();
    await this.authz.require(principal, action, confidentialResource('conversation', row));
    return toConversationView(row, await this.repo.listMessages(row.id));
  }
}
