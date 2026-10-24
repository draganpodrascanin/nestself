/**
 * Shared types for the ContentRenderer and block components.
 *
 * These types define the "props contract" between the renderer and
 * the host app (workspace, admin preview). Media URLs, CTA resolution
 * and related-resource resolution are injected as functions so the
 * renderer stays independent of the read model and routing.
 */
/**
 * Media rendition names for image delivery (section 8.4).
 * The host app resolves `mediaUrl(assetId, rendition)` to a delivery URL.
 */
export type MediaRendition = 'card' | 'detail';

/**
 * Resolves a media asset id and rendition to a delivery URL.
 */
export type MediaUrlResolver = (assetId: string, rendition: MediaRendition) => string;

/**
 * CTA target resolution result.
 * Returns a ReactNode (rendered button/link) or null when the CTA target
 * is unavailable (the renderer renders nothing).
 */
export interface ResolvedCta {
  /** The URL or action target. */
  href: string;
  /** Display label (falls back to a default if not provided). */
  label: string;
  /** Whether this is a navigation link (true) or an action button (false). */
  isLink: boolean;
}

export type CtaResolver = (cta: {
  ctaKind: string;
  targetId?: string | null;
  label?: string | null;
}) => ResolvedCta | null;

/**
 * Related resource resolution result.
 */
export interface ResolvedRelatedResource {
  /** Display title. */
  title: string;
  /** Navigation URL. */
  href: string;
  /** Optional description/outcome text. */
  description?: string;
}

export type RelatedResourceResolver = (id: string) => ResolvedRelatedResource | null;

/**
 * Resolves a `nestself:content/<id>` internal link to an app-specific
 * navigation path, or returns null when the target is unavailable
 * (the link renders as plain text in that case).
 *
 * The workspace app maps to `/content/<id>`, the admin preview to
 * `/admin/content/<id>/preview`, etc.
 */
export type InternalLinkResolver = (contentResourceId: string) => string | null;

/**
 * Props for the ContentRenderer.
 */
export interface ContentRendererProps {
  /** A validated ContentDocument. */
  document: {
    type: 'doc';
    schemaVersion: number;
    content: unknown[];
  };
  /** Resolves a media asset id to a delivery URL. */
  mediaUrl: MediaUrlResolver;
  /** Resolves a CTA to a rendered action or null. */
  resolveCta: CtaResolver;
  /** Resolves a related resource id to display data or null. */
  resolveRelated: RelatedResourceResolver;
  /**
   * Resolves an internal `nestself:content/<id>` link to an app path.
   * Returns null when the target is unavailable (renders plain text).
   */
  resolveInternalLink: InternalLinkResolver;
  /**
   * Offset heading levels so the page title can be h1.
   * Default 0: sectionHeading level 2 renders as h2.
   * Set to 1 to render level 2 as h3 and level 3 as h4.
   */
  headingOffset?: number;
}
