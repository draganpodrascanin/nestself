/**
 * `approvalResource`: the `@Authorize()` resource resolver of
 * `POST /appointment-approvals/:id/approve|reject` (T-CW-1.10, guidelines
 * 7.1). The routes carry no `:orgId`; the resolver loads the item and derives
 * the organization and the employee's unit from it, and the guard's
 * `authorize()` then requires `approval.decide` there (the `approver`
 * template's organization grant).
 *
 * Only the item's approver and its alternate get a resource: anybody else,
 * including another approver of the same organization, gets 404 here, so an
 * item never discloses itself to someone it was not routed to (CALL-17,
 * D-CW-30). A missing item is 404 too, without the `'__not_found__'`
 * placeholder of guidelines 7.1 (see `appointment.resolver.ts`).
 *
 * The self-approval rule and the check that the decider's authority still
 * covers the employee's unit run in `ApprovalService`, where the employee and
 * the authorities are loaded.
 *
 * `AppointmentsModule` binds the repository at start-up; an unbound lookup
 * throws (500): the route fails closed.
 */
import type { Principal, Resource } from '@nestself/contracts';
import type { ResourceResolver } from '../authz/authorize.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
import type { ApprovalRow } from './approval.repository.js';

export interface ApprovalLookup {
  findById(id: string): Promise<ApprovalRow | null>;
}

let lookup: ApprovalLookup | null = null;

/** Called by `AppointmentsModule` on init (the repository) and on destroy (null). */
export function bindApprovalLookup(next: ApprovalLookup | null): void {
  lookup = next;
}

export const APPROVAL_RESOURCE_TYPE = 'appointment_approval';

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

/** True when `userId` is the item's approver or its alternate. */
export function isNamedDecider(row: Pick<ApprovalRow, 'approverUserId' | 'alternateUserId'>, userId: string): boolean {
  return row.approverUserId === userId || row.alternateUserId === userId;
}

export const approvalResource: ResourceResolver = async (
  req: Record<string, unknown>,
  principal: Principal,
): Promise<Resource> => {
  const id = (req['params'] as Record<string, string | undefined> | undefined)?.['id'];
  if (!id) throw notFound();
  if (!lookup) throw new Error('approvalResource: AppointmentsModule has not bound the approval lookup');
  const row = await lookup.findById(id);
  if (!row || !isNamedDecider(row, principal.userId)) throw notFound();
  return {
    type: APPROVAL_RESOURCE_TYPE,
    id: row.id,
    orgId: row.orgId,
    ...(row.orgUnitId ? { orgUnitId: row.orgUnitId } : {}),
  };
};
