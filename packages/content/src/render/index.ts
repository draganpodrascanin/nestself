// ---------------------------------------------------------------------------
// Content renderer — React block components for ContentDocument (FMT-R-14)
// Exported from @nestself/content/render
// ---------------------------------------------------------------------------

export { ContentRenderer } from './ContentRenderer.tsx';

export type {
  ContentRendererProps,
  MediaUrlResolver,
  MediaRendition,
  CtaResolver,
  ResolvedCta,
  RelatedResourceResolver,
  ResolvedRelatedResource,
} from './types.ts';

export { isSafeHref, isInternalHref, extractContentId } from './safe-href.ts';
