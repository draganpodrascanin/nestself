/**
 * ProfessionalService: reads of the confidential professional-interaction
 * domain (T-2.4, section 4.7). Each method loads the row, builds the
 * confidential resource from it and calls `AuthorizationService.require`
 * before reading or returning any content; a denial is audited there as
 * `access.denied` with identifiers only. Message bodies and intake text are
 * never logged or written to audit details.
 *
 * Emergency reads (`records.read.emergency`) belong to T-2.5.
 */
import { Injectable } from '@nestjs/common';
import type { Action, Principal, Resource } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ProfessionalRepository } from '../db/repositories/professional.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
import { ApiHttpException } from '../common/api-error.js';

export interface ConversationView {
  id: string;
  caseId: string;
  orgId: string;
  messages: { id: string; authorUserId: string; body: string; createdAt: Date }[];
}

export interface IntakeView {
  id: string;
  caseId: string;
  orgId: string;
  body: string;
  createdAt: Date;
}

/**
 * The confidential resource for a case-bound row. `id` is the case id
 * because CASE assignments target cases; `ownerId` is the employee, which
 * the participant (`own`) path matches.
 */
function confidentialResource(
  type: 'conversation' | 'intake',
  row: { caseId: string; orgId: string; employeeUserId: string },
): Resource {
  return { type, id: row.caseId, orgId: row.orgId, ownerId: row.employeeUserId, isConfidential: true };
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

@Injectable()
export class ProfessionalService {
  constructor(
    private readonly repo: ProfessionalRepository,
    private readonly authz: AuthorizationService,
  ) {}

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
    return { id: row.id, caseId: row.caseId, orgId: row.orgId, body: row.body, createdAt: row.createdAt };
  }

  private async readConversation(principal: Principal, id: string, action: Action): Promise<ConversationView> {
    const row = await this.repo.findConversation(id);
    if (!row) throw notFound();
    await this.authz.require(principal, action, confidentialResource('conversation', row));
    const messages = await this.repo.listMessages(row.id);
    return {
      id: row.id,
      caseId: row.caseId,
      orgId: row.orgId,
      messages: messages.map((m) => ({ id: m.id, authorUserId: m.authorUserId, body: m.body, createdAt: m.createdAt })),
    };
  }
}
