/**
 * Text block components: SectionHeading, ContentParagraph, lists, Quote.
 */
import type { RenderContext } from './context.ts';
import { renderInlineNodes } from './inline.tsx';

// ---------------------------------------------------------------------------
// Shared raw-node shape
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// SectionHeading
// ---------------------------------------------------------------------------

export function SectionHeading({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const rawLevel = Number(node.attrs?.level);
  // Schema allows 2 | 3; clamp to 2..6 for safety (item 7)
  const level = Number.isFinite(rawLevel) ? Math.max(2, Math.min(rawLevel, 6)) : 2;
  const offset = Math.max(0, ctx.headingOffset);
  const effectiveLevel = Math.min(level + offset, 6) as 2 | 3 | 4 | 5 | 6;
  const Tag = `h${effectiveLevel}` as const;
  return (
    <Tag className="text-text type-section-title mt-8 mb-3 first:mt-0">
      {renderInlineNodes(node.content as unknown[] | undefined, ctx)}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// ContentParagraph
// ---------------------------------------------------------------------------

export function ContentParagraph({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  return (
    <p className="text-text type-body mb-4 last:mb-0">
      {renderInlineNodes(node.content as unknown[] | undefined, ctx)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

// Forward-declared to break the cycle with dispatch
// (ListItem renders BlockNode for nested lists)
import { BlockNode } from './dispatch.tsx';

export function BulletList({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  return (
    <ul className="text-text type-body list-disc pl-6 mb-4 space-y-1">
      {node.content?.map((item, i) => (
        <ListItem key={i} node={item} ctx={ctx} />
      ))}
    </ul>
  );
}

export function OrderedList({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : undefined;
  return (
    <ol
      className="text-text type-body list-decimal pl-6 mb-4 space-y-1"
      {...(start != null ? { start } : {})}
    >
      {node.content?.map((item, i) => (
        <ListItem key={i} node={item} ctx={ctx} />
      ))}
    </ol>
  );
}

export function ListItem({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  return (
    <li>
      {node.content?.map((child, i) => (
        <BlockNode key={i} node={child} ctx={ctx} />
      ))}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Quote (item 12: no `italic` class, style with border and secondary text)
// ---------------------------------------------------------------------------

export function Quote({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const attribution = typeof node.attrs?.attribution === 'string'
    ? node.attrs.attribution
    : null;
  return (
    <blockquote className="border-l-4 border-border-control pl-4 mb-4 text-text-secondary">
      {node.content?.map((child, i) => (
        <ContentParagraph key={i} node={child} ctx={ctx} />
      ))}
      {attribution ? (
        <footer className="mt-2 text-text-secondary type-metadata not-italic">
          {attribution}
        </footer>
      ) : null}
    </blockquote>
  );
}
