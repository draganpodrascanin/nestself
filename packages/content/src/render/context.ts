/**
 * RenderContext — the shared context passed through the block tree.
 *
 * Extracted from ContentRendererProps so block components receive only
 * the resolved values they need, not the full document or raw props.
 */
import type {
  MediaUrlResolver,
  MediaAssetMeta,
  CtaResolver,
  RelatedResourceResolver,
  InternalLinkResolver,
  LinkComponentType,
  ContentRendererLabels,
} from './types.ts';

export interface RenderContext {
  media: Record<string, MediaAssetMeta>;
  mediaUrl: MediaUrlResolver;
  resolveCta: CtaResolver;
  resolveRelated: RelatedResourceResolver;
  resolveInternalLink: InternalLinkResolver;
  linkComponent?: LinkComponentType;
  labels: ContentRendererLabels;
  headingOffset: number;
}
