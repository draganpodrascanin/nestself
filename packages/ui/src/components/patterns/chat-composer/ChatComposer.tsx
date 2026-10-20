import { useRef, useEffect } from 'react';
import { cn } from '../../../lib/cn';

export interface ChatComposerLabels {
  message: string;
  send: string;
  retry: string;
  failedNotice: string;
  sentNotice: string;
}

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  draftState: 'idle' | 'sending' | 'failed';
  labels: ChatComposerLabels;
  className?: string;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  draftState,
  labels,
  className,
}: ChatComposerProps) {
  const retryRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevDraftState = useRef(draftState);

  // On failure, focus the retry button
  // On retry success (failed -> idle), return focus to the input
  useEffect(() => {
    if (draftState === 'failed' && retryRef.current) {
      retryRef.current.focus();
    }
    if (prevDraftState.current === 'failed' && draftState === 'idle') {
      inputRef.current?.focus();
    }
    prevDraftState.current = draftState;
  }, [draftState]);

  const handleSend = () => {
    if (value.trim() && draftState !== 'sending') {
      onSend();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={cn('bg-surface border-t border-border-subtle px-5 py-5', className)}>
      {draftState === 'failed' ? (
        <p className="type-metadata text-danger mb-2" role="alert">
          {labels.failedNotice}
        </p>
      ) : null}
      <div className="flex gap-3 items-end">
        <label className="flex-1">
          <span className="sr-only">{labels.message}</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={draftState === 'failed'}
            aria-readonly={draftState === 'failed' || undefined}
            placeholder={labels.message}
            className={cn(
              'w-full min-h-11 rounded-control border border-border-control bg-surface px-3 py-2 type-body',
              'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
              'pointer-coarse:min-h-12',
              draftState === 'failed' && 'opacity-70',
            )}
          />
        </label>
        {draftState === 'failed' ? (
          <button
            ref={retryRef}
            type="button"
            onClick={handleSend}
            className={cn(
              'inline-flex items-center justify-center min-h-11 px-5 py-2.5 rounded-control border border-transparent bg-primary text-on-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
              'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
              'pointer-coarse:min-h-12',
            )}
          >
            {labels.retry}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!value.trim() || draftState === 'sending'}
            aria-busy={draftState === 'sending' || undefined}
            className={cn(
              'inline-flex items-center justify-center min-h-11 px-5 py-2.5 rounded-control border border-transparent bg-primary text-on-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
              'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
              'disabled:bg-disabled-surface disabled:text-disabled-text disabled:cursor-not-allowed',
              'pointer-coarse:min-h-12',
            )}
          >
            {labels.send}
          </button>
        )}
      </div>
    </div>
  );
}
