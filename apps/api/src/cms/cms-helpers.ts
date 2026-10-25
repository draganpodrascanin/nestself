/**
 * CMS pure helper functions (T-C1.10).
 *
 * Extracted from cms.service.ts so they can be unit-tested directly
 * without instantiating the service or its dependencies.
 */
import { ApiHttpException } from '../common/api-error.js';

// ---------------------------------------------------------------------------
// Media node extraction from ProseMirror documents
// ---------------------------------------------------------------------------

export interface MediaRef {
  mediaAssetId: string;
  usageKind: 'inline_image' | 'body_media';
}

/**
 * Walk a ProseMirror document and collect media references.
 * Maps `image` → `inline_image`, `approvedMedia` → `body_media`.
 * Deduplicates by `mediaAssetId` (first occurrence wins).
 */
export function extractMediaRefs(doc: Record<string, unknown>): MediaRef[] {
  const refs: MediaRef[] = [];
  const seen = new Set<string>();

  function walk(node: Record<string, unknown>) {
    // image node → inline_image role
    if (node.type === 'image' && node.attrs) {
      const attrs = node.attrs as Record<string, unknown>;
      if (typeof attrs.mediaAssetId === 'string' && !seen.has(attrs.mediaAssetId)) {
        seen.add(attrs.mediaAssetId);
        refs.push({ mediaAssetId: attrs.mediaAssetId, usageKind: 'inline_image' });
      }
    }
    // approvedMedia node → body_media role
    if (node.type === 'approvedMedia' && node.attrs) {
      const attrs = node.attrs as Record<string, unknown>;
      if (typeof attrs.mediaAssetId === 'string' && !seen.has(attrs.mediaAssetId)) {
        seen.add(attrs.mediaAssetId);
        refs.push({ mediaAssetId: attrs.mediaAssetId, usageKind: 'body_media' });
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content as Record<string, unknown>[]) {
        walk(child);
      }
    }
  }
  walk(doc);
  return refs;
}

// ---------------------------------------------------------------------------
// Audience containment (pure, without DB lookups)
// ---------------------------------------------------------------------------

type AudienceEntry = {
  kind: string;
  orgId?: string;
  orgUnitId?: string;
  includeDescendants?: boolean;
};

/**
 * Pure audience containment check (C-12), without DB lookups for org unit
 * membership. The full containment check in CmsService also validates
 * org unit → org relationships via the database.
 *
 * When `proposedAudience` is null/undefined/empty, every publish entry
 * is rejected (fail-closed).
 */
export function checkAudienceContainmentPure(
  publishAudience: AudienceEntry[],
  proposedAudience: unknown,
): void {
  // Fail-closed: null/undefined/non-array proposed → reject all
  if (!proposedAudience || !Array.isArray(proposedAudience) || proposedAudience.length === 0) {
    if (publishAudience.length > 0) {
      throw new ApiHttpException({
        status: 403,
        code: 'content_audience_exceeds_approval',
        message: 'No proposed audience was approved; cannot publish to any audience',
      });
    }
    return;
  }
  const proposed = proposedAudience as AudienceEntry[];
  const proposedHasAllEligible = proposed.some((a) => a.kind === 'all_eligible');

  for (const pub of publishAudience) {
    if (pub.kind === 'all_eligible') {
      if (!proposedHasAllEligible) {
        throw new ApiHttpException({
          status: 403,
          code: 'content_audience_exceeds_approval',
          message: 'Publication audience exceeds the approved proposed audience',
        });
      }
      continue;
    }
    if (pub.kind === 'organization') {
      if (proposedHasAllEligible) continue;
      const orgMatch = proposed.some(
        (p) => p.kind === 'organization' && p.orgId === pub.orgId,
      );
      if (!orgMatch) {
        throw new ApiHttpException({
          status: 403,
          code: 'content_audience_exceeds_approval',
          message: `Organization ${pub.orgId} is not in the approved proposed audience`,
        });
      }
      continue;
    }
    if (pub.kind === 'org_unit') {
      if (proposedHasAllEligible) continue;
      const orgCover = proposed.some(
        (p) => p.kind === 'organization' && p.orgId === pub.orgId,
      );
      if (orgCover) continue;
      const unitCover = proposed.some(
        (p) =>
          p.kind === 'org_unit' &&
          p.orgId === pub.orgId &&
          p.orgUnitId === pub.orgUnitId &&
          ((p.includeDescendants ?? true) || !(pub.includeDescendants ?? true)),
      );
      if (!unitCover) {
        throw new ApiHttpException({
          status: 403,
          code: 'content_audience_exceeds_approval',
          message: `Org unit ${pub.orgUnitId} exceeds the approved proposed audience`,
        });
      }
    }
  }
}
