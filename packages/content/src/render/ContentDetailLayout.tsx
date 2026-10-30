/**
 * ContentDetailLayout — shared detail page layout for content resources
 * (FMT-R-16, FMT-R-24, WRK-R-35).
 *
 * Renders title, outcome, duration, reviewer/author, date and body via
 * ContentRenderer, using the same tokens and heading structure across the
 * admin preview and the workspace detail page. Body section headings start
 * at h2 (FMT-R-16: headingOffset = 0).
 *
 * Used by both the admin preview panel and the workspace detail page.
 * Workspace-specific chrome (back-navigation, save button, sources,
 * related resources) is injected through optional slots so the shared
 * content presentation cannot drift between the two apps.
 */
import type { ReactNode } from 'react';
import { ContentRenderer } from './ContentRenderer.tsx';
import type { ContentRendererProps } from './types.ts';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ContentDetailLayoutProps
  extends Omit<ContentRendererProps, 'headingOffset'> {
  /** Article title (h1). */
  title: string;
  /** Expected outcome line shown below the title (nullable). */
  outcome?: string | null;
  /** Duration in seconds (nullable). */
  durationSeconds?: number | null;
  /** Formatted duration string (e.g. "5 min"). Overrides durationSeconds. */
  durationLabel?: string | null;
  /** Author or reviewer name. */
  author?: string | null;
  /** Publication or last-updated date string. */
  dateLabel?: string | null;
  /** Additional metadata rendered between the header and the body. */
  headerExtra?: ReactNode;

  // -- Slots for host-app chrome (all optional, backward compatible) --------

  /** Content rendered above the title (e.g. back-navigation link). */
  beforeTitle?: ReactNode;
  /** Summary text rendered after the title, before the metadata row. */
  summary?: string | null;
  /**
   * Heading label for the outcome section. When set, the outcome is wrapped
   * in a `<section>` with an h2. When omitted, the outcome renders as a
   * secondary paragraph (the admin preview default).
   */
  outcomeLabel?: string;
  /** Extra elements appended to the metadata row (e.g. category badge). */
  metaExtra?: ReactNode;
  /** Content rendered after the body, inside the article (e.g. save button). */
  afterBody?: ReactNode;
  /**
   * CSS class for the wrapper `<article>`.
   * Defaults to `'mx-auto max-w-[720px] px-4'`.
   */
  className?: string;
}

// ---------------------------------------------------------------------------
// Duration formatting helper
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContentDetailLayout({
  title,
  outcome,
  durationSeconds,
  durationLabel,
  author,
  dateLabel,
  headerExtra,
  beforeTitle,
  summary,
  outcomeLabel,
  metaExtra,
  afterBody,
  className = 'mx-auto max-w-[720px] px-4',
  ...rendererProps
}: ContentDetailLayoutProps) {
  const duration =
    durationLabel ?? (durationSeconds ? formatDuration(durationSeconds) : null);

  return (
    <article className={className}>
      {beforeTitle}

      {/* Title — h1, always the page heading */}
      <h1 className="type-heading-lg text-text">{title}</h1>

      {/* Summary — secondary text below the title */}
      {summary && (
        <p className="mt-1 type-body text-text-secondary">{summary}</p>
      )}

      {/* Meta line: author, date, duration, extras */}
      {(author || dateLabel || duration || metaExtra) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-metadata text-text-secondary">
          {author && <span>{author}</span>}
          {dateLabel && <span>{dateLabel}</span>}
          {duration && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden>·</span>
              {duration}
            </span>
          )}
          {metaExtra}
        </div>
      )}

      {/* Outcome — section with heading when outcomeLabel is set, paragraph otherwise */}
      {outcomeLabel && outcome ? (
        <section className="mt-3">
          <h2 className="type-heading-sm text-text mb-1">{outcomeLabel}</h2>
          <p className="type-body text-text-secondary">{outcome}</p>
        </section>
      ) : outcome ? (
        <p className="mt-3 type-body text-text-secondary">{outcome}</p>
      ) : null}

      {headerExtra}

      {/* Separator */}
      <hr className="my-6 border-border" />

      {/* Body — headingOffset 0: sectionHeading level 2 renders as h2 */}
      <div className="prose-content">
        <ContentRenderer {...rendererProps} headingOffset={0} />
      </div>

      {afterBody}
    </article>
  );
}
