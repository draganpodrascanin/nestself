/**
 * Resource resolvers of the workplace review routes that address a record by
 * `:id` without an `:orgId` in the path (guidelines 7.1), bound by
 * `WorkplaceReviewsModule` at start-up like `appointmentResource`.
 *
 * - `reviewScopeResource`: the scope being accepted or rejected carries its
 *   amount and currency, so the approver's spending ceiling applies to it
 *   (ADR 0002, D-EL-04) and `category: 'workplace_review'` lets a categories
 *   condition narrow an approver to this service.
 * - `reviewEngagementResource`: the engagement for the reviewer's routes; the
 *   reviewer's `assigned_cases` grant needs a current CASE assignment on it.
 */
import type { Principal, Resource } from '@nestself/contracts';
import type { ResourceResolver } from '../authz/authorize.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
import type { EngagementRow, ScopeRow } from './workplace-reviews.repository.js';

export interface ReviewLookup {
  findScope(id: string): Promise<ScopeRow | null>;
  findEngagement(id: string): Promise<EngagementRow | null>;
}

let lookup: ReviewLookup | null = null;

export function bindReviewLookup(next: ReviewLookup | null): void {
  lookup = next;
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

function paramId(req: Record<string, unknown>, name: string): string {
  const id = (req['params'] as Record<string, string | undefined> | undefined)?.[name];
  if (!id) throw notFound();
  return id;
}

function requireLookup(): ReviewLookup {
  if (!lookup) throw new Error('workplace review resolvers: WorkplaceReviewsModule has not bound the lookup');
  return lookup;
}

/**
 * The scope as the spending-ceiling condition sees it. An open quote (no price
 * yet) exceeds every ceiling: nobody can bind a scope whose amount is not
 * defined, so the guard refuses before the service does.
 */
export function scopeResourceOf(row: Pick<ScopeRow, 'id' | 'orgId' | 'priceMinor' | 'currency'>): Resource {
  return { type: 'review_scope', id: row.id, orgId: row.orgId, amountMinor: row.priceMinor ?? Number.MAX_SAFE_INTEGER, currency: row.currency, category: 'workplace_review' };
}

export function engagementResourceOf(row: Pick<EngagementRow, 'id' | 'orgId'>): Resource {
  return { type: 'review_engagement', id: row.id, orgId: row.orgId };
}

/** The scope named by `:scopeId`, in the organization of the route (`:orgId` must match, or the row is treated as missing). */
export const reviewScopeResource: ResourceResolver = async (req: Record<string, unknown>, _principal: Principal): Promise<Resource> => {
  const id = paramId(req, 'scopeId');
  const orgId = paramId(req, 'orgId');
  const row = await requireLookup().findScope(id);
  if (!row || row.orgId !== orgId) throw notFound();
  return scopeResourceOf(row);
};

export const reviewEngagementResource: ResourceResolver = async (req: Record<string, unknown>, _principal: Principal): Promise<Resource> => {
  const id = paramId(req, 'id');
  const row = await requireLookup().findEngagement(id);
  if (!row) throw notFound();
  return engagementResourceOf(row);
};
