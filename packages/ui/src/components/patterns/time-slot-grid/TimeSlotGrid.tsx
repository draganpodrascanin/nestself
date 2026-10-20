import { cn } from '../../../lib/cn';
import { VisuallyHidden } from '../../foundation/visually-hidden/VisuallyHidden';

export interface TimeSlot {
  id: string;
  label: string;
  available: boolean;
}

export interface TimeSlotGridProps {
  slots: TimeSlot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  timeZoneLabel: string;
  className?: string;
}

export function TimeSlotGrid({
  slots,
  selectedId,
  onSelect,
  timeZoneLabel,
  className,
}: TimeSlotGridProps) {
  return (
    <div role="radiogroup" aria-label={timeZoneLabel} className={cn('grid grid-cols-2 gap-3 mt-6', className)}>
      <VisuallyHidden>{timeZoneLabel}</VisuallyHidden>
      {slots.map((slot) => (
        <button
          key={slot.id}
          type="button"
          aria-pressed={selectedId === slot.id}
          disabled={!slot.available}
          onClick={() => onSelect(slot.id)}
          className={cn(
            'inline-flex items-center justify-center min-h-12 rounded-control border border-border-control bg-surface text-text px-3 py-1.5 type-body transition-colors duration-[var(--motion-fast)]',
            'aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {slot.label}
        </button>
      ))}
    </div>
  );
}
