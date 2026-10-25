/**
 * ContentDetailLayout — shared detail page layout for content resources
 * (FMT-R-16, WRK-R-35).
 *
 * Renders title, outcome, duration, reviewer/author, date and body via
 * ContentRenderer, using the same tokens and heading structure that the
 * workspace detail page will adopt. Body section headings start at h2
 * (FMT-R-16: headingOffset = 0).
 *
 * The workspace will adopt this layout in a later round; for now it is
 * used by the admin preview panel and the published content pages.
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
  ...rendererProps
}: ContentDetailLayoutProps) {
  const duration =
    durationLabel ?? (durationSeconds ? formatDuration(durationSeconds) : null);

  return (
    <article className="mx-auto max-w-[720px] px-4">
      {/* Title — h1, always the page heading */}
      <h1 className="type-heading-lg text-text">{title}</h1>

      {/* Meta line: author, date, duration */}
      {(author || dateLabel || duration) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-metadata text-text-secondary">
          {author && <span>{author}</span>}
          {dateLabel && <span>{dateLabel}</span>}
          {duration && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden>·</span>
              {duration}
            </span>
          )}
        </div>
      )}

      {/* Outcome */}
      {outcome && (
        <p className="mt-3 type-body text-text-secondary">{outcome}</p>
      )}

      {headerExtra}

      {/* Separator */}
      <hr className="my-6 border-border" />

      {/* Body — headingOffset 0: sectionHeading level 2 renders as h2 */}
      <div className="prose-content">
        <ContentRenderer {...rendererProps} headingOffset={0} />
      </div>
    </article>
  );
}
