/**
 * ContentRenderer (FMT-R-14, 6.8).
 *
 * Maps a validated ContentDocument to React elements via an explicit
 * node-type-to-component map. No dangerouslySetInnerHTML, no innerHTML,
 * no HTML sanitizer. Text is rendered as React children (auto-escaped).
 *
 * Hosts must run `migrateDocument` + `validateContentDocument` before
 * rendering. The renderer performs best-effort defense-in-depth but is
 * not a validation layer.
 */
import { BlockNode } from './dispatch.tsx';
import type { RenderContext } from './context.ts';
import type { ContentRendererProps } from './types.ts';

/**
 * Renders a validated ContentDocument as React elements.
 *
 * The reading-width container is set by the parent layout; the
 * renderer itself is unstyled at the outer level (it renders blocks
 * that assume they fill the available width).
 *
 * `documentKey` is used as the React key on the block container so
 * that checklist state (and any other local state) resets when the
 * document changes — even within the same mount point (item 13).
 */
export function ContentRenderer({
  document: doc,
  media,
  mediaUrl,
  resolveCta,
  resolveRelated,
  resolveInternalLink,
  linkComponent,
  labels,
  documentKey,
  headingOffset = 0,
}: ContentRendererProps) {
  const ctx: RenderContext = {
    media,
    mediaUrl,
    resolveCta,
    resolveRelated,
    resolveInternalLink,
    linkComponent,
    labels,
    headingOffset: Math.max(0, headingOffset),
  };

  return (
    <div key={documentKey} role="article">
      {(doc.content as Array<{ type: string; [k: string]: unknown }>).map((node, i) => (
        <BlockNode key={i} node={node} ctx={ctx} />
      ))}
    </div>
  );
}
