/**
 * ContentRenderer (FMT-R-14, 6.8).
 *
 * Maps a validated ContentDocument to React elements via an explicit
 * node-type-to-component map. No dangerouslySetInnerHTML, no innerHTML,
 * no HTML sanitizer. Text is rendered as React children (auto-escaped).
 *
 * Props:
 * - document: a validated ContentDocument
 * - mediaUrl: resolves asset id + rendition to a delivery URL
 * - resolveCta: resolves a CTA to a rendered action or null
 * - resolveRelated: resolves a related resource id or null
 * - headingOffset: shifts heading levels (default 0)
 */
import { BlockNode, type BlockContext } from './blocks.tsx';
import type { ContentRendererProps } from './types.ts';

/**
 * Renders a validated ContentDocument as React elements.
 *
 * The reading-width container is set by the parent layout; the
 * renderer itself is unstyled at the outer level (it renders blocks
 * that assume they fill the available width).
 */
export function ContentRenderer({
  document: doc,
  mediaUrl,
  resolveCta,
  resolveRelated,
  headingOffset = 0,
}: ContentRendererProps) {
  const ctx: BlockContext = {
    mediaUrl,
    resolveCta,
    resolveRelated,
    headingOffset,
  };

  return (
    <div data-testid="content-renderer">
      {(doc.content as Array<Record<string, unknown>>).map((node, i) => (
        <BlockNode key={i} node={node as never} ctx={ctx} />
      ))}
    </div>
  );
}
