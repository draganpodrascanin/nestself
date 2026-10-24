/**
 * The confidential resource and response views of professional records
 * (T-2.4). Shared by the professional routes and the emergency record read
 * (T-2.5) so both authorize the same resource and return the same body;
 * these are pure functions, not the service (CONF-R-03).
 */
import type { Resource } from '@nestself/contracts';
import type {
  ConversationMessageRow,
  ConversationRow,
  IntakeRecordRow,
} from '../db/repositories/professional.repository.js';

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
 * because CASE assignments and CASE emergency scopes target cases;
 * `ownerId` is the employee, which the participant (`own`) path and the
 * USER_RECORDS emergency scope match.
 */
export function confidentialResource(
  type: 'conversation' | 'intake',
  row: { caseId: string; orgId: string; employeeUserId: string },
): Resource {
  return { type, id: row.caseId, orgId: row.orgId, ownerId: row.employeeUserId, isConfidential: true };
}

export function toConversationView(row: ConversationRow, messages: ConversationMessageRow[]): ConversationView {
  return {
    id: row.id,
    caseId: row.caseId,
    orgId: row.orgId,
    messages: messages.map((m) => ({ id: m.id, authorUserId: m.authorUserId, body: m.body, createdAt: m.createdAt })),
  };
}

export function toIntakeView(row: IntakeRecordRow): IntakeView {
  return { id: row.id, caseId: row.caseId, orgId: row.orgId, body: row.body, createdAt: row.createdAt };
}
