// ---------------------------------------------------------------------------
// Content renderer — React block components for ContentDocument (FMT-R-14)
// Exported from @nestself/content/render
// ---------------------------------------------------------------------------

export { ContentRenderer } from './ContentRenderer.tsx';

export type {
  ContentRendererProps,
  MediaUrlResolver,
  MediaAssetMeta,
  MediaRenditionKind,
  CtaResolver,
  ResolvedCta,
  CtaLink,
  CtaAction,
  RelatedResourceResolver,
  ResolvedRelatedResource,
  InternalLinkResolver,
  LinkComponentType,
  ContentRendererLabels,
} from './types.ts';

export { isSafeHref, isInternalHref, extractContentId, isSafeAppHref } from './safe-href.ts';

export { ContentDetailLayout } from './ContentDetailLayout.tsx';
export type { ContentDetailLayoutProps } from './ContentDetailLayout.tsx';
