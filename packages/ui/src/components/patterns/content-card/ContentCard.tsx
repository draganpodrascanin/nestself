import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface ContentCardProps {
  /** Resource ID for data-* attributes. */
  resourceId: string;
  /** Image URL (optional). Falls back to an illustration placeholder. */
  imageUrl?: string | null;
  /** Focal point for the cover image ({x, y} in [0,1] range). */
  focalPoint?: { x: number; y: number } | null;
  /** Alt text for the cover image. */
  imageAlt?: string;
  /** Title (max two visual lines, truncated). */
  title: string;
  /** Short outcome sentence. */
  outcome?: string | null;
  /** Content format label (e.g. "Article"). */
  formatLabel: string;
  /** Duration badge rendered by the host. */
  durationBadge?: ReactNode;
  /** Whether the item is saved. */
  saved?: boolean;
  /** Called when save is toggled. */
  onToggleSave?: () => void;
  /** Label for the save button (a11y). */
  saveLabel?: string;
  /** Label for the unsave button (a11y). */
  unsaveLabel?: string;
  /** Whether the card is a placeholder (sample data). */
  placeholder?: boolean;
  /** Wraps the card in a link or makes it interactive. */
  children?: ReactNode;
  /** Click handler on the card body. */
  onClick?: () => void;
  /** href for the card link (used when children is not provided). */
  href?: string;
  /** Link render prop: receives (props) and returns a link element. */
  renderLink?: (props: {
    href: string;
    className: string;
    children: ReactNode;
  }) => ReactNode;
  className?: string;
}

export function ContentCard({
  resourceId,
  imageUrl,
  focalPoint,
  imageAlt = '',
  title,
  outcome,
  formatLabel,
  durationBadge,
  saved,
  onToggleSave,
  saveLabel,
  unsaveLabel,
  placeholder,
  href,
  renderLink,
  className,
}: ContentCardProps) {
  const objectPosition = focalPoint
    ? `${focalPoint.x * 100}% ${focalPoint.y * 100}%`
    : undefined;

  const cardContent = (
    <>
      {/* Cover image or placeholder */}
      <div className="relative aspect-[16/10] overflow-hidden rounded-t-card bg-tint">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt}
            className="h-full w-full object-cover"
            style={objectPosition ? { objectPosition } : undefined}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-accent-soft">
            <span className="type-metadata text-text-secondary" aria-hidden>
              {formatLabel}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="type-label line-clamp-2">{title}</h3>
        {outcome ? (
          <p className="type-body text-text-secondary line-clamp-2">{outcome}</p>
        ) : null}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <span className="type-metadata text-text-secondary">{formatLabel}</span>
          {durationBadge}
        </div>
      </div>
    </>
  );

  const cardClasses = cn(
    'group relative flex flex-col rounded-card border border-border-subtle bg-surface',
    'transition-[border-color,box-shadow] duration-[var(--motion-fast)] ease-standard',
    'motion-reduce:transition-none',
    'hover:border-primary hover:shadow-low',
    'focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus',
    className,
  );

  return (
    <article
      className={cardClasses}
      data-resource-id={resourceId}
      data-placeholder={placeholder ? 'true' : undefined}
    >
      {href && renderLink ? (
        renderLink({
          href,
          className: 'absolute inset-0 z-[1] rounded-card focus:outline-none',
          children: <span className="sr-only">{title}</span>,
        })
      ) : href ? (
        <a
          href={href}
          className="absolute inset-0 z-[1] rounded-card focus:outline-none"
        >
          <span className="sr-only">{title}</span>
        </a>
      ) : null}

      {cardContent}

      {/* Save button (above the link overlay) */}
      {onToggleSave ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSave();
          }}
          aria-label={saved ? unsaveLabel : saveLabel}
          aria-pressed={saved}
          className={cn(
            'absolute right-3 top-3 z-[2] flex h-9 w-9 items-center justify-center',
            'rounded-full bg-surface/80 backdrop-blur-sm',
            'transition-colors duration-[var(--motion-fast)] ease-standard',
            'motion-reduce:transition-none',
            'hover:bg-surface',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        >
          {saved ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 256 256"
              fill="currentColor"
              className="text-primary"
              aria-hidden
            >
              <path d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Z" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 256 256"
              fill="none"
              stroke="currentColor"
              strokeWidth="16"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-text-secondary"
              aria-hidden
            >
              <path d="M184,32H72A16,16,0,0,0,56,48V224l72-40,72,40V48A16,16,0,0,0,184,32Z" />
            </svg>
          )}
        </button>
      ) : null}
    </article>
  );
}
