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
// CTA extraction from ProseMirror documents (FMT-R-27)
// ---------------------------------------------------------------------------

export interface CtaRef {
  kind: string;
  targetId?: string;
}

/**
 * Walk a ProseMirror document and find the first `cta` node.
 * Returns `null` when no CTA node is present in the document.
 *
 * FMT-R-27: the body document is the single source of truth for CTA;
 * the top-level `cta` field is derived from this node on save.
 *
 * The schema node stores the CTA kind as `ctaKind` in attrs
 * (see packages/content/src/schema/blocks.ts CtaAttrsSchema).
 */
export function extractCtaFromBody(doc: Record<string, unknown>): CtaRef | null {
  let found: CtaRef | null = null;

  function walk(node: Record<string, unknown>) {
    if (found) return; // first occurrence wins
    if (node.type === 'cta' && node.attrs) {
      const attrs = node.attrs as Record<string, unknown>;
      if (typeof attrs.ctaKind === 'string' && attrs.ctaKind.length > 0) {
        found = {
          kind: attrs.ctaKind,
          targetId: typeof attrs.targetId === 'string' ? attrs.targetId : undefined,
        };
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content as Record<string, unknown>[]) {
        walk(child);
      }
    }
  }
  walk(doc);
  return found;
}

// ---------------------------------------------------------------------------
// Business-day arithmetic (review_due_at)
// ---------------------------------------------------------------------------

/**
 * Add `days` business days to the given date (skips Saturday/Sunday)
 * computed in the Europe/Belgrade timezone.
 *
 * Used to set `review_due_at` on submit (2 business days per SLA).
 *
 * Note: RS/HU public holidays will be handled by BusinessClock in T-C3.06;
 * for now, only weekends are skipped.
 */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  // Use Europe/Belgrade timezone to determine the day-of-week, so the
  // business-day calculation is correct regardless of the server's local
  // timezone (the data-residency region is eu-central-1 / CET).
  const belgradeDay = (d: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'Europe/Belgrade',
    }).formatToParts(d);
    const wd = parts.find((p) => p.type === 'weekday')!.value;
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wd] ?? 0;
  };
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = belgradeDay(result);
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
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
