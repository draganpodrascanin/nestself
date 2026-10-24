/**
 * Block components for the ContentRenderer (FMT-R-15, 6.8.1).
 *
 * Each node type from C-05 maps to a React component. No
 * dangerouslySetInnerHTML, no innerHTML — text is rendered as
 * React children (auto-escaped by React).
 *
 * Design decision (T-C1.06): external links open in the same tab by
 * default. The spec says "decide and document whether external links
 * open in the same tab" — we follow the principle of least surprise
 * and keep users in the same tab. An accessible "opens in new tab"
 * hint is therefore not needed. See FMT-R-17 for the full rule
 * (admin override may change this for the workspace app later).
 *
 * Update (FMT-R-17 says _blank): The strategy doc section 6.8.3
 * explicitly says external links open in a new tab with
 * `rel="noopener noreferrer"` and `target="_blank"`. We follow the
 * strategy document.
 */
import { type ReactNode, useState, useRef, useEffect } from 'react';

import { isSafeHref, isInternalHref } from './safe-href.ts';
import type {
  MediaUrlResolver,
  CtaResolver,
  RelatedResourceResolver,
} from './types.ts';

// ---------------------------------------------------------------------------
// Context type passed through the tree
// ---------------------------------------------------------------------------

export interface BlockContext {
  mediaUrl: MediaUrlResolver;
  resolveCta: CtaResolver;
  resolveRelated: RelatedResourceResolver;
  headingOffset: number;
}

// ---------------------------------------------------------------------------
// Raw node types (generic, matching the ContentDocument shape)
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Inline rendering: text with marks
// ---------------------------------------------------------------------------

function renderInlineNodes(
  nodes: RawNode[] | undefined,
  ctx: BlockContext,
): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, i) => renderInlineNode(node, ctx, i));
}

function renderInlineNode(
  node: RawNode,
  _ctx: BlockContext,
  key: number,
): ReactNode {
  if (node.type === 'hardBreak') {
    return <br key={key} />;
  }

  if (node.type === 'text') {
    let content: ReactNode = node.text ?? '';

    // Apply marks in order: bold, italic, link
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'bold') {
          content = <strong key={`${key}-bold`}>{content}</strong>;
        } else if (mark.type === 'italic') {
          content = <em key={`${key}-italic`}>{content}</em>;
        } else if (mark.type === 'link') {
          const href = mark.attrs?.href as string | undefined;
          if (href && isSafeHref(href)) {
            if (isInternalHref(href)) {
              // Internal links: resolve to /content/<id>
              const contentId = href.slice('nestself:content/'.length);
              content = (
                <a
                  key={`${key}-link`}
                  href={`/content/${contentId}`}
                  className="text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {content}
                </a>
              );
            } else {
              // External links open in a new tab (FMT-R-17)
              content = (
                <a
                  key={`${key}-link`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {content}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              );
            }
          }
          // else: unsafe href — render as plain text (defense in depth, 6.9)
        }
      }
    }

    return <span key={key}>{content}</span>;
  }

  // Unknown inline node: render nothing (closed catalogue)
  return null;
}

// ---------------------------------------------------------------------------
// Block components (FMT-R-15)
// ---------------------------------------------------------------------------

function SectionHeading({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const level = (node.attrs?.level as number) ?? 2;
  const effectiveLevel = Math.min(level + ctx.headingOffset, 6);
  const Tag = `h${effectiveLevel}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <Tag className="text-text type-heading-sm mt-8 mb-3 first:mt-0">
      {renderInlineNodes(node.content, ctx)}
    </Tag>
  );
}

function ContentParagraph({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  return (
    <p className="text-text type-body mb-4 last:mb-0">
      {renderInlineNodes(node.content, ctx)}
    </p>
  );
}

function BulletList({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  return (
    <ul className="text-text type-body list-disc pl-6 mb-4 space-y-1">
      {node.content?.map((item, i) => (
        <ListItem key={i} node={item} ctx={ctx} />
      ))}
    </ul>
  );
}

function OrderedList({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const start = (node.attrs?.start as number | null) ?? undefined;
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

function ListItem({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  return (
    <li>
      {node.content?.map((child, i) => (
        <BlockNode key={i} node={child} ctx={ctx} />
      ))}
    </li>
  );
}

function Quote({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const attribution = node.attrs?.attribution as string | null | undefined;
  return (
    <blockquote className="border-l-4 border-border-control pl-4 mb-4 text-text-secondary italic">
      {node.content?.map((child, i) => (
        <ContentParagraph key={i} node={child} ctx={ctx} />
      ))}
      {attribution ? (
        <footer className="mt-2 text-text-tertiary type-caption not-italic">
          {attribution}
        </footer>
      ) : null}
    </blockquote>
  );
}

function ContentImage({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const mediaAssetId = node.attrs?.mediaAssetId as string;
  const alt = node.attrs?.alt as string;
  const caption = node.attrs?.caption as string | null | undefined;
  const src = ctx.mediaUrl(mediaAssetId, 'detail');

  return (
    <figure className="mb-4">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="w-full rounded-lg"
      />
      {caption ? (
        <figcaption className="mt-2 text-text-tertiary type-caption text-center">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

const NOTE_KIND_LABELS: Record<string, string> = {
  warning: 'Warning',
  tip: 'Tip',
  disclaimer: 'Disclaimer',
};

const NOTE_KIND_STYLES: Record<string, string> = {
  warning: 'border-warning bg-warning/5',
  tip: 'border-success bg-success/5',
  disclaimer: 'border-border-control bg-surface-raised',
};

function ProfessionalNote({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const noteKind = (node.attrs?.noteKind as string) ?? 'tip';
  const label = NOTE_KIND_LABELS[noteKind] ?? 'Note';
  const styles = NOTE_KIND_STYLES[noteKind] ?? 'border-border-control bg-surface-raised';

  return (
    <aside
      role="note"
      aria-label={label}
      className={`border-l-4 rounded-r-lg p-4 mb-4 ${styles}`}
    >
      <p className="text-text type-label mb-2">{label}</p>
      {node.content?.map((child, i) => (
        <ContentParagraph key={i} node={child} ctx={ctx} />
      ))}
    </aside>
  );
}

function PracticalStep({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const stepNumber = node.attrs?.stepNumber as number;
  const title = node.attrs?.title as string;

  return (
    <section aria-label={title} className="mb-6">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="flex-none w-7 h-7 rounded-full bg-primary text-on-primary type-label flex items-center justify-center" aria-hidden="true">
          {stepNumber}
        </span>
        <p className="text-text type-label">{title}</p>
      </div>
      <div className="pl-10">
        {node.content?.map((child, i) => (
          <ContentParagraph key={i} node={child} ctx={ctx} />
        ))}
      </div>
    </section>
  );
}

function ChecklistItemComponent({
  node,
  ctx,
  checked,
  onToggle,
}: {
  node: RawNode;
  ctx: BlockContext;
  checked: boolean;
  onToggle: () => void;
}) {
  const label = node.attrs?.label as string;
  return (
    <li className="flex items-start gap-3 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={label}
        className="mt-1 accent-primary"
      />
      <span className={`text-text type-body ${checked ? 'line-through text-text-tertiary' : ''}`}>
        {renderInlineNodes(node.content, ctx) ?? label}
      </span>
    </li>
  );
}

function Checklist({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const items = node.content ?? [];
  const [checked, setChecked] = useState<boolean[]>(() =>
    new Array(items.length).fill(false) as boolean[],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list role when list-style:none; explicit role restores it
    <ul role="list" aria-label="Checklist" className="mb-4 space-y-0.5 list-none">
      {items.map((item, i) => (
        <ChecklistItemComponent
          key={i}
          node={item}
          ctx={ctx}
          checked={checked[i] ?? false}
          onToggle={() => {
            setChecked((prev) => {
              const next = [...prev];
              next[i] = !next[i];
              return next;
            });
          }}
        />
      ))}
    </ul>
  );
}

function ApprovedMedia({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const mediaAssetId = node.attrs?.mediaAssetId as string;
  const kind = node.attrs?.kind as string;
  const caption = node.attrs?.caption as string | null | undefined;

  if (kind === 'audio') {
    const src = ctx.mediaUrl(mediaAssetId, 'detail');
    return (
      <div className="mb-4">
        <AudioPlayer src={src} caption={caption} />
      </div>
    );
  }

  if (kind === 'video') {
    const src = ctx.mediaUrl(mediaAssetId, 'detail');
    return (
      <div className="mb-4">
        <VideoPlayer src={src} caption={caption} />
      </div>
    );
  }

  if (kind === 'pdf') {
    const src = ctx.mediaUrl(mediaAssetId, 'detail');
    return (
      <div className="mb-4">
        <a
          href={src}
          download
          className="inline-flex items-center gap-2 text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span aria-hidden="true" className="type-label">PDF</span>
          {caption ?? 'Download PDF'}
        </a>
      </div>
    );
  }

  return null;
}

/**
 * AudioPlayer — native <audio> with controls, no autoplay (FMT-R-25).
 * Paused on mount (verified by test).
 */
function AudioPlayer({ src, caption }: { src: string; caption?: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);

  // Ensure paused on mount (defense in depth for FMT-R-25)
  useEffect(() => {
    if (ref.current && !ref.current.paused) {
      ref.current.pause();
    }
  }, []);

  return (
    <figure>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- transcripts are separate blocks */}
      <audio
        ref={ref}
        controls
        preload="metadata"
        src={src}
        className="w-full"
      />
      {caption ? (
        <figcaption className="mt-1 text-text-tertiary type-caption">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * VideoPlayer — native <video> with controls, no autoplay (FMT-R-25).
 * Paused on mount (verified by test).
 */
function VideoPlayer({ src, caption }: { src: string; caption?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);

  // Ensure paused on mount (defense in depth for FMT-R-25)
  useEffect(() => {
    if (ref.current && !ref.current.paused) {
      ref.current.pause();
    }
  }, []);

  return (
    <figure>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- transcripts are separate blocks */}
      <video
        ref={ref}
        controls
        preload="metadata"
        src={src}
        className="w-full rounded-lg"
      />
      {caption ? (
        <figcaption className="mt-1 text-text-tertiary type-caption">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * TranscriptPanel — a disclosure using <details>/<summary> (6.8.1).
 *
 * The Motion rule requires animated open/close for disclosures. We
 * use native <details> with CSS transitions on the panel content.
 * The `@base-ui/react` Accordion was considered, but using native
 * <details> is simpler and satisfies a11y (aria-expanded is implicit).
 *
 * Content is present in the DOM when collapsed (via CSS) so screen
 * readers can reach it and search engines index it.
 */
function TranscriptPanel({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  return (
    <details className="mb-4 border border-border-subtle rounded-lg">
      <summary className="cursor-pointer px-4 py-3 text-text type-label select-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus">
        Transcript
      </summary>
      <div className="px-4 pb-4 text-text-secondary type-body">
        {node.content?.map((child, i) => (
          <ContentParagraph key={i} node={child} ctx={ctx} />
        ))}
      </div>
    </details>
  );
}

function RelatedResourceCard({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const contentResourceId = node.attrs?.contentResourceId as string;
  const resolved = ctx.resolveRelated(contentResourceId);

  // Renders nothing when the target is unavailable (FMT-R-15)
  if (!resolved) return null;

  return (
    <div className="mb-4 p-4 border border-border-subtle rounded-lg bg-surface-raised">
      <a
        href={resolved.href}
        className="text-primary type-label underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {resolved.title}
      </a>
      {resolved.description ? (
        <p className="mt-1 text-text-secondary type-body">{resolved.description}</p>
      ) : null}
    </div>
  );
}

function ContentCta({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  const attrs = node.attrs as {
    ctaKind: string;
    targetId?: string | null;
    label?: string | null;
  } | undefined;

  if (!attrs) return null;

  const resolved = ctx.resolveCta(attrs);

  // Renders nothing when the CTA target is unavailable (FMT-R-15)
  if (!resolved) return null;

  if (resolved.isLink) {
    return (
      <div className="mb-4">
        <a
          href={resolved.href}
          className="inline-flex items-center justify-center rounded-lg bg-primary text-on-primary px-6 py-3 type-label hover:bg-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus transition-colors"
        >
          {resolved.label}
        </a>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-lg bg-primary text-on-primary px-6 py-3 type-label hover:bg-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus transition-colors"
      >
        {resolved.label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block node dispatcher
// ---------------------------------------------------------------------------

export function BlockNode({ node, ctx }: { node: RawNode; ctx: BlockContext }) {
  switch (node.type) {
    case 'sectionHeading':
      return <SectionHeading node={node} ctx={ctx} />;
    case 'paragraph':
      return <ContentParagraph node={node} ctx={ctx} />;
    case 'bulletList':
      return <BulletList node={node} ctx={ctx} />;
    case 'orderedList':
      return <OrderedList node={node} ctx={ctx} />;
    case 'listItem':
      return <ListItem node={node} ctx={ctx} />;
    case 'quote':
      return <Quote node={node} ctx={ctx} />;
    case 'image':
      return <ContentImage node={node} ctx={ctx} />;
    case 'professionalNote':
      return <ProfessionalNote node={node} ctx={ctx} />;
    case 'practicalStep':
      return <PracticalStep node={node} ctx={ctx} />;
    case 'checklist':
      return <Checklist node={node} ctx={ctx} />;
    case 'approvedMedia':
      return <ApprovedMedia node={node} ctx={ctx} />;
    case 'transcript':
      return <TranscriptPanel node={node} ctx={ctx} />;
    case 'relatedResource':
      return <RelatedResourceCard node={node} ctx={ctx} />;
    case 'cta':
      return <ContentCta node={node} ctx={ctx} />;
    default:
      // Unknown node type: render nothing (closed catalogue)
      return null;
  }
}
