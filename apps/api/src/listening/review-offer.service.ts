/**
 * ReviewOfferService: whether the current report shows the one consolidated
 * invitation to request a workplace review (spec 4.5, REV-01). Every
 * condition is evaluated on the server from the protected result; the client
 * renders what it receives. Active requests and engagements come from the
 * workplace-reviews module once it exists (`ACTIVE_REVIEW_LOOKUP`); until then
 * the lookup answers none.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ListeningDimensionKey, Principal, ReviewOffer } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository, type CellRow } from './listening.repository.js';

/** The workplace-reviews module's answer to "is there active work for this scope". */
export interface ActiveReviewLookup {
  findActive(orgId: string, cohortKey: string): Promise<{ requestId: string | null; engagementId: string | null }>;
}

export const ACTIVE_REVIEW_LOOKUP = Symbol('ACTIVE_REVIEW_LOOKUP');

export interface OfferContext {
  orgId: string;
  snapshotId: string;
  cohortKey: string;
  /** Whether the latest result is older than the freshness window. */
  stale: boolean;
  /** Whether workplace reviews are available to the organization. */
  workplaceReviewsEnabled: boolean;
  /** The stored cells of the displayed scope. */
  cells: readonly CellRow[];
}

@Injectable()
export class ReviewOfferService {
  constructor(
    private readonly repo: ListeningRepository,
    private readonly authz: AuthorizationService,
    @Optional() @Inject(ACTIVE_REVIEW_LOOKUP) private readonly activeReviews: ActiveReviewLookup | null = null,
  ) {}

  /** Null when the capability is off; otherwise the offer with every condition resolved. */
  async evaluate(principal: Principal, ctx: OfferContext): Promise<ReviewOffer | null> {
    if (!ctx.workplaceReviewsEnabled) return null;
    const dangerKeys = ctx.cells
      .filter((c) => c.cohortKey === ctx.cohortKey && c.suppression === null && c.status === 'danger')
      .map((c) => c.dimensionKey as ListeningDimensionKey);
    const [mayRequest, dismissed, active] = await Promise.all([
      this.authz.allows(principal, 'workplace_reviews.request', { type: 'workplace_review', orgId: ctx.orgId }),
      this.repo.findDismissal(ctx.snapshotId, principal.userId),
      this.activeReviews?.findActive(ctx.orgId, ctx.cohortKey) ?? Promise.resolve({ requestId: null, engagementId: null }),
    ]);
    return {
      eligible: mayRequest && !ctx.stale && dangerKeys.length > 0 && active.requestId === null && active.engagementId === null && !dismissed,
      dimensionKeys: dangerKeys,
      activeRequestId: active.requestId,
      activeEngagementId: active.engagementId,
      dismissed,
    };
  }
}
