/**
 * `feedbackCaseResource`: the `@Authorize()` resource resolver for the handler
 * routes that address a case by `:id` (spec FBK-02, FBK-04). The case is a
 * confidential resource: `authorize()` lets only the `feedback_case.*`
 * actions reach it, and the handler's `assigned_cases` grant needs a current
 * CASE assignment on this very case. The resource carries the organization
 * and the id, never the reporter.
 *
 * A missing row answers 404 here; every denial is answered 404 by the guard
 * (`denyAs: 'not_found'`), so the existence of a case is never confirmed to
 * someone who may not read it. Resolvers are plain functions in decorator
 * metadata, outside dependency injection, so `FeedbackCasesModule` binds the
 * repository at start-up ({@link bindFeedbackCaseLookup}); an unbound lookup
 * throws and the route fails closed.
 */
import type { Principal, Resource } from '@nestself/contracts';
import type { ResourceResolver } from '../authz/authorize.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
import type { CaseRow } from './feedback-cases.repository.js';

export interface FeedbackCaseLookup {
  findCase(id: string): Promise<CaseRow | null>;
}

let lookup: FeedbackCaseLookup | null = null;

export function bindFeedbackCaseLookup(next: FeedbackCaseLookup | null): void {
  lookup = next;
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

export function caseResource(row: Pick<CaseRow, 'id' | 'orgId'>): Resource {
  return { type: 'feedback_case', id: row.id, orgId: row.orgId, isConfidential: true };
}

export const feedbackCaseResource: ResourceResolver = async (req: Record<string, unknown>, _principal: Principal): Promise<Resource> => {
  const id = (req['params'] as Record<string, string | undefined> | undefined)?.['id'];
  if (!id) throw notFound();
  if (!lookup) throw new Error('feedbackCaseResource: FeedbackCasesModule has not bound the case lookup');
  const row = await lookup.findCase(id);
  if (!row) throw notFound();
  return caseResource(row);
};
