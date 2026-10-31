/**
 * Shared types for the ContentRenderer and block components.
 *
 * These types define the "props contract" between the renderer and
 * the host app (workspace, admin preview). Media URLs, CTA resolution,
 * related-resource resolution and internal-link resolution are injected
 * as functions so the renderer stays independent of the read model and routing.
 *
 * Hosts must run `migrateDocument` + `validateContentDocument` before
 * rendering; the renderer performs best-effort defense-in-depth but is
 * not a validation layer.
 */
import type { ComponentType, ReactNode } from 'react';

import type { MediaRenditionKind } from '@nestself/contracts';

// Re-export for convenience
export type { MediaRenditionKind } from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Media read model (item 1)
// ---------------------------------------------------------------------------

/**
 * Per-asset media metadata from the read model.
 * Hosts build this record from the content resource's media join.
 */
export interface MediaAssetMeta {
  kind: 'image' | 'audio' | 'video' | 'pdf' | 'captions';
  renditions: MediaRenditionKind[];
  width?: number;
  height?: number;
  focalPoint?: { x: number; y: number };
}

/**
 * Resolves a media asset id and rendition to a delivery URL.
 * The contracts `MediaRenditionKind` enum is used for type safety.
 */
export type MediaUrlResolver = (assetId: string, rendition: MediaRenditionKind) => string;

// ---------------------------------------------------------------------------
// CTA (item 16: discriminated union)
// ---------------------------------------------------------------------------

/** A CTA that navigates to a URL. */
export interface CtaLink {
  kind: 'link';
  href: string;
  label: string;
}

/** A CTA that triggers a callback action. */
export interface CtaAction {
  kind: 'action';
  onActivate: () => void;
  label: string;
}

export type ResolvedCta = CtaLink | CtaAction;

export type CtaResolver = (cta: {
  ctaKind: string;
  targetId?: string | null;
  label?: string | null;
}) => ResolvedCta | null;

// ---------------------------------------------------------------------------
// Related resource
// ---------------------------------------------------------------------------

export interface ResolvedRelatedResource {
  title: string;
  href: string;
  description?: string;
}

export type RelatedResourceResolver = (id: string) => ResolvedRelatedResource | null;

// ---------------------------------------------------------------------------
// Internal link resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a `nestself:content/<id>` internal link to an app-specific
 * navigation path, or returns null when the target is unavailable
 * (the link renders as plain text in that case).
 */
export type InternalLinkResolver = (contentResourceId: string) => string | null;

// ---------------------------------------------------------------------------
// Link component (item 2)
// ---------------------------------------------------------------------------

/**
 * A custom link component the host passes so internal links use TanStack
 * Router `Link` (or any framework's link primitive) instead of plain `<a>`.
 * Default: plain `<a>`.
 */
export type LinkComponentType = ComponentType<{
  href: string;
  children: ReactNode;
  className?: string;
}>;

// ---------------------------------------------------------------------------
// Labels (item 4)
// ---------------------------------------------------------------------------

/**
 * Every user-facing string in the renderer. Hosts pass translated strings;
 * the renderer has no hard-coded English. Follows the `PhotoFigure` `photoBy`
 * pattern from `@nestself/ui`.
 */
export interface ContentRendererLabels {
  /** Transcript disclosure trigger label. */
  transcript: string;
  /** Note kind labels keyed by noteKind. */
  noteWarning: string;
  noteTip: string;
  noteDisclaimer: string;
  noteDefault: string;
  /** Checklist group label. */
  checklist: string;
  /** SR-only hint appended to external links. */
  opensInNewTab: string;
  /** PDF download link text (fallback when no caption). */
  downloadPdf: string;
  /** Alt text for an image whose asset is unavailable. */
  imageUnavailable: string;
}

// ---------------------------------------------------------------------------
// ContentRendererProps
// ---------------------------------------------------------------------------

export interface ContentRendererProps {
  /** A validated ContentDocument (run migrateDocument + validation first). */
  document: {
    type: 'doc';
    schemaVersion: number;
    content: unknown[];
  };
  /**
   * Media asset metadata from the read model, keyed by asset id.
   * A media block whose asset id is missing from this record renders nothing.
   */
  media: Record<string, MediaAssetMeta>;
  /** Resolves a media asset id + rendition to a delivery URL. */
  mediaUrl: MediaUrlResolver;
  /** Resolves a CTA to a link or action, or null. */
  resolveCta: CtaResolver;
  /** Resolves a related resource id to display data or null. */
  resolveRelated: RelatedResourceResolver;
  /** Resolves nestself:content/<id> to an app path or null (plain text). */
  resolveInternalLink: InternalLinkResolver;
  /**
   * Custom link component for internal links (e.g. TanStack Router Link).
   * Default: plain `<a>`.
   */
  linkComponent?: LinkComponentType;
  /**
   * Translated labels for all user-facing strings.
   * No hard-coded English (the `PhotoFigure` `photoBy` pattern).
   */
  labels: ContentRendererLabels;
  /**
   * A stable key (e.g. content resource revision id) that resets
   * checklist state when the document changes. Without it, checked
   * state could leak between documents in the same mount point.
   */
  documentKey: string;
  /**
   * Offset heading levels so the page title can be h1.
   * Default 0: sectionHeading level 2 renders as h2.
   * Set to 1 to render level 2 as h3. Clamped to [0, 4].
   */
  headingOffset?: number;
}
