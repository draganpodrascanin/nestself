/**
 * Inline node rendering — text with marks (bold, italic, link).
 *
 * Adjacent text nodes sharing the same link mark are grouped into
 * a single `<a>` element (item 14: one tab stop, one SR hint).
 *
 * External links open in a new tab (FMT-R-17) with `rel="noopener noreferrer"`.
 * Internal links (`nestself:content/<id>`) are resolved via
 * `resolveInternalLink` and rendered with `linkComponent`.
 */
import type { ReactNode } from 'react';

import { ContentIdSchema } from '../schema/blocks.ts';

import { extractContentId, isInternalHref, isSafeAppHref, isSafeHref } from './safe-href.ts';
import type { RenderContext } from './context.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawInlineNode {
  type: string;
  text?: unknown;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Link mark grouping (item 14)
// ---------------------------------------------------------------------------

interface LinkGroup {
  href: string;
  nodes: Array<{ node: RawInlineNode; index: number }>;
}

/**
 * Groups adjacent inline nodes that share the same link mark href
 * into a single LinkGroup, so they render as one `<a>` element.
 */
function groupByLink(nodes: RawInlineNode[]): Array<LinkGroup | { node: RawInlineNode; index: number }> {
  const result: Array<LinkGroup | { node: RawInlineNode; index: number }> = [];
  let currentGroup: LinkGroup | null = null;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const linkMark = node.marks?.find((m) => m.type === 'link');
    const href = linkMark?.attrs?.href;

    if (typeof href === 'string' && href) {
      if (currentGroup && currentGroup.href === href) {
        currentGroup.nodes.push({ node, index: i });
      } else {
        if (currentGroup) result.push(currentGroup);
        currentGroup = { href, nodes: [{ node, index: i }] };
      }
    } else {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push({ node, index: i });
    }
  }
  if (currentGroup) result.push(currentGroup);
  return result;
}

// ---------------------------------------------------------------------------
// Render a single inline node (without link wrapping)
// ---------------------------------------------------------------------------

function renderTextContent(node: RawInlineNode, key: number): ReactNode {
  if (node.type === 'hardBreak') return <br key={key} />;
  if (node.type !== 'text') return null;

  // String guard (item 7)
  const text = typeof node.text === 'string' ? node.text : '';
  let content: ReactNode = text;

  // Apply non-link marks
  if (node.marks) {
    for (const mark of node.marks) {
      if (mark.type === 'bold') {
        content = <strong key={`${key}-b`}>{content}</strong>;
      } else if (mark.type === 'italic') {
        // Onest has no italic face; font-synthesis-style: none prevents
        // the browser from synthesizing one (design-handoff rule). The
        // editor will not offer italic (T-C1.12 note).
        content = (
          <em key={`${key}-i`} style={{ fontSynthesisStyle: 'none' }}>
            {content}
          </em>
        );
      }
      // link marks are handled by the grouping layer above
    }
  }

  return <span key={key}>{content}</span>;
}

// ---------------------------------------------------------------------------
// Render a grouped link
// ---------------------------------------------------------------------------

function renderLinkGroup(group: LinkGroup, ctx: RenderContext): ReactNode {
  const { href } = group;
  const key = `link-${group.nodes[0]!.index}`;
  const children = group.nodes.map(({ node, index }) => renderTextContent(node, index));

  if (isInternalHref(href)) {
    const contentId = extractContentId(href);
    if (!contentId) return <>{children}</>;

    // Validate the id with ContentIdSchema before calling the resolver (item 5)
    if (!ContentIdSchema.safeParse(contentId).success) return <>{children}</>;

    const resolved = ctx.resolveInternalLink(contentId);
    if (!resolved) return <>{children}</>;

    // Check resolver-returned href (item 6)
    if (!isSafeAppHref(resolved)) return <>{children}</>;

    const Link = ctx.linkComponent ?? 'a';
    return (
      <Link
        key={key}
        href={resolved}
        className="text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {children}
      </Link>
    );
  }

  // External link
  if (!isSafeHref(href)) return <>{children}</>;

  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {children}
      <span className="sr-only"> ({ctx.labels.opensInNewTab})</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderInlineNodes(
  nodes: unknown[] | undefined,
  ctx: RenderContext,
): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  const typed = nodes as RawInlineNode[];

  const groups = groupByLink(typed);
  return groups.map((item, _gi) => {
    if ('href' in item) {
      return renderLinkGroup(item, ctx);
    }
    return renderTextContent(item.node, item.index);
  });
}
