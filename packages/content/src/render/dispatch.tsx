/**
 * Block-node dispatcher with typed dispatch map and error boundary.
 *
 * Item 17: a mapped type over the schema BlockNode union; dispatch with
 * Object.hasOwn; `listItem` not accepted at top level.
 * Item 7: error boundary per block rendering nothing for that block
 * (dev warning).
 */
import { Component, type ReactNode, type ComponentType } from 'react';

import type { BlockNode as BlockNodeType } from '../schema/blocks.ts';

import type { RenderContext } from './context.ts';
import { SectionHeading, ContentParagraph, BulletList, OrderedList, ListItem, Quote } from './text-blocks.tsx';
import { ContentImage, ApprovedMedia, TranscriptPanel } from './media.tsx';
import { ProfessionalNote, PracticalStep } from './aside-blocks.tsx';
import { Checklist } from './checklist.tsx';
import { RelatedResourceCard, ContentCta } from './action-blocks.tsx';

// ---------------------------------------------------------------------------
// Raw node shape (untyped; validation ran before rendering)
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Typed dispatch map (item 17)
// ---------------------------------------------------------------------------

/**
 * Block types accepted at the top level of a document.
 * `listItem` is NOT included — it only appears inside lists.
 */
type TopLevelBlockType = Exclude<BlockNodeType['type'], 'listItem'>;

type BlockComponent = ComponentType<{ node: RawNode; ctx: RenderContext }>;

/**
 * Typed map: every top-level block type must have a component.
 * A missing entry is a compile error.
 */
const BLOCK_MAP: Record<TopLevelBlockType, BlockComponent> = {
  sectionHeading: SectionHeading,
  paragraph: ContentParagraph,
  bulletList: BulletList,
  orderedList: OrderedList,
  quote: Quote,
  image: ContentImage,
  professionalNote: ProfessionalNote,
  practicalStep: PracticalStep,
  checklist: Checklist,
  approvedMedia: ApprovedMedia,
  transcript: TranscriptPanel,
  relatedResource: RelatedResourceCard,
  cta: ContentCta,
};

// ---------------------------------------------------------------------------
// Error boundary (item 7)
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  nodeType: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class BlockErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[ContentRenderer] Error rendering block "${this.props.nodeType}":`,
        error,
      );
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// BlockNode dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches a block node to the correct component.
 * Used by ContentRenderer for top-level blocks and by ListItem for
 * nested content. Unknown or listItem nodes at the top level render nothing.
 */
export function BlockNode({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const type = typeof node?.type === 'string' ? node.type : '';

  // listItem at top level renders as a generic block dispatch to its children
  if (type === 'listItem') {
    return <ListItem node={node} ctx={ctx} />;
  }

  if (!Object.hasOwn(BLOCK_MAP, type)) {
    // Unknown node type: render nothing (closed catalogue)
    return null;
  }

  const Comp = BLOCK_MAP[type as TopLevelBlockType];
  return (
    <BlockErrorBoundary nodeType={type}>
      <Comp node={node} ctx={ctx} />
    </BlockErrorBoundary>
  );
}
