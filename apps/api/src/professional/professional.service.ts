/**
 * ProfessionalService: reads of the confidential professional-interaction
 * domain (T-2.4, section 4.7). Each method loads the row, builds the
 * confidential resource from it and calls `AuthorizationService.require`
 * before reading or returning any content; a denial is audited there as
 * `access.denied` with identifiers only. Message bodies and intake text are
 * never logged or written to audit details.
 *
 * Emergency reads (`records.read.emergency`) live in the emergency module
 * and share `professional-records.ts`.
 */
import { Injectable } from '@nestjs/common';
import type { Action, Principal } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ProfessionalRepository } from '../db/repositories/professional.repository.js';
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
    return toIntakeView(row);
  }

  private async readConversation(principal: Principal, id: string, action: Action): Promise<ConversationView> {
    const row = await this.repo.findConversation(id);
    if (!row) throw notFound();
    await this.authz.require(principal, action, confidentialResource('conversation', row));
    return toConversationView(row, await this.repo.listMessages(row.id));
  }
}
