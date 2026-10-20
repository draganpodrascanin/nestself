import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface PrivacyAtPointOfUseProps {
  question: string;
  explanation: ReactNode;
  learnMoreLabel?: string;
  onLearnMore?: () => void;
  className?: string;
}

export function PrivacyAtPointOfUse({
  question,
  explanation,
  learnMoreLabel,
  onLearnMore,
  className,
}: PrivacyAtPointOfUseProps) {
  return (
    <details className={cn('group', className)}>
      <summary
        className={cn(
          'min-h-11 flex items-center cursor-pointer type-metadata text-primary font-[var(--font-weight-label)]',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          'pointer-coarse:min-h-12',
        )}
      >
        {question}
      </summary>
      <div className="pb-3 type-metadata text-text-secondary">
        <p>{explanation}</p>
        {learnMoreLabel && onLearnMore ? (
          <button
            type="button"
            onClick={onLearnMore}
            className={cn(
              'mt-2 text-primary underline underline-offset-[0.2em] hover:text-primary-hover type-metadata',
              'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            {learnMoreLabel}
          </button>
        ) : null}
      </div>
    </details>
  );
}
