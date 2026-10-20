import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '../../../lib/cn';
import { AlertDialog, AlertDialogContent } from '../../dialogs/alert-dialog';
import { Avatar } from '../avatar/Avatar';
import { TimeSlotGrid } from '../time-slot-grid/TimeSlotGrid';
import { CostBreakdown } from '../cost-breakdown/CostBreakdown';
import { ConfirmLabel } from '../confirm-label/ConfirmLabel';
import type { TimeSlot } from '../time-slot-grid/TimeSlotGrid';


export interface BookingDemoAdvisor {
  name: string;
  initials: string;
  title: string;
  meta: string;
}

export interface BookingDemoPricing {
  price: number;
  employerCovers: number;
  youPay: number;
}

export interface BookingDemoLabels {
  step: string;
  chooseAdvisor: string;
  advisorLead: string;
  timesAvailable: string;
  seeTimes: string;
  chooseTime: string;
  reviewAndConfirm: string;
  confirm: string;
  terms: string;
  termsTitle: string;
  termsBody: string;
  termsAccept: string;
  termsCancel: string;
  doneTitle: string;
  doneMessage: string;
  doneAnnouncement: string;
  reset: string;
  price: string;
  employerCovers: string;
  youPay: string;
  timeZoneLabel: string;
  continueLabel: string;
  back: string;
  /** @deprecated Kept for backward compatibility; no longer rendered. */
  chooseSlot?: string;
  /** @deprecated Kept for backward compatibility; no longer rendered. */
  selectTime?: string;
  /** @deprecated Kept for backward compatibility; no longer rendered. */
  advisorCard?: string;
}

type StepValue = 1 | 2 | 3 | 'done';

export interface BookingDemoProps {
  advisor: BookingDemoAdvisor;
  slots: TimeSlot[];
  pricing: BookingDemoPricing;
  timeZone: string;
  dateLabel: string;
  labels: BookingDemoLabels;
  formatCurrency: (amount: number) => string;
  onAnnounce?: (message: string) => void;
  className?: string;
  /** Used by stories and tests to render a specific step on mount. */
  initialStep?: StepValue;
  /** Formats the "Step n of total" label for the active locale, e.g. (c, t) => t('booking.step', { current: c, total: t }). Falls back to English. */
  formatStep?: (current: number, total: number) => string;
  /** Used by stories and tests to preselect a slot on mount. */
  initialSelectedSlotId?: string;
}

export function BookingDemo({
  advisor,
  slots,
  pricing,
  timeZone,
  dateLabel,
  labels,
  formatCurrency,
  onAnnounce,
  className,
  initialStep = 1,
  formatStep,
  initialSelectedSlotId,
}: BookingDemoProps) {
  const [step, setStep] = useState<StepValue>(initialStep);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(initialSelectedSlotId ?? null);
  const [termsOpen, setTermsOpen] = useState(false);

  const step1Ref = useRef<HTMLHeadingElement>(null);
  const step2Ref = useRef<HTMLHeadingElement>(null);
  const step3Ref = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const focusHeading = useCallback((ref: React.RefObject<HTMLHeadingElement | null>) => {
    requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (step === 1) focusHeading(step1Ref);
    if (step === 2) focusHeading(step2Ref);
    if (step === 3) focusHeading(step3Ref);
    if (step === 'done') focusHeading(doneRef);
  }, [step, focusHeading]);

  const goToStep = useCallback((nextStep: StepValue) => {
    setStep(nextStep);
  }, []);

  const handleConfirm = () => {
    setStep('done');
    onAnnounce?.(labels.doneAnnouncement);
  };

  const handleReset = () => {
    setSelectedSlotId(null);
    setStep(1);
  };

  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const stepLabel = (n: number) => (formatStep ? formatStep(n, 3) : `${labels.step} ${n} of 3`);

  const ghostButtonClasses = cn(
    'inline-flex items-center justify-center min-h-11 px-5 py-2.5 rounded-control border border-border-control bg-surface text-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
    'hover:bg-tint',
    'pointer-coarse:min-h-12',
  );

  const primaryButtonClasses = cn(
    'inline-flex items-center justify-center w-full min-h-11 px-5 py-2.5 rounded-control border border-transparent bg-primary text-on-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
    'disabled:bg-disabled-surface disabled:text-disabled-text disabled:cursor-not-allowed',
    'pointer-coarse:min-h-12',
  );

  /* ------------------------------------------------------------------ */
  /* Done panel                                                          */
  /* ------------------------------------------------------------------ */
  if (step === 'done') {
    return (
      <div className={cn('border border-border-subtle rounded-card bg-surface p-8 text-center', className)}>
        <h3
          ref={doneRef}
          tabIndex={-1}
          className="type-section-title mb-4 outline-none"
        >
          {labels.doneTitle}
        </h3>
        <p className="type-body text-text-secondary mb-6">{labels.doneMessage}</p>
        <button
          type="button"
          onClick={handleReset}
          className={ghostButtonClasses}
        >
          {labels.reset}
        </button>
      </div>
    );
  }

  return (
    <div className={cn('border border-border-subtle rounded-card bg-surface', className)}>
      {/* ---------------------------------------------------------------- */}
      {/* Step 1: Choose an advisor                                        */}
      {/* ---------------------------------------------------------------- */}
      {step === 1 ? (
        <div className="p-6">
          <p className="type-metadata text-text-secondary mb-2">{stepLabel(1)}</p>
          <h3
            ref={step1Ref}
            tabIndex={-1}
            className="type-section-title mb-2 outline-none"
          >
            {labels.chooseAdvisor}
          </h3>
          <p className="type-body text-text-secondary mb-6">{labels.advisorLead}</p>

          <div className="flex items-center gap-4 mb-4">
            <Avatar initials={advisor.initials} name={advisor.name} size="md" />
            <div>
              <p className="font-[var(--font-weight-label)]">{advisor.name}</p>
              <p className="type-metadata text-text-secondary">{advisor.title}</p>
              <p className="type-metadata text-text-secondary">{advisor.meta}</p>
            </div>
          </div>

          <p className="type-metadata text-success mb-6">{labels.timesAvailable}</p>

          <button
            type="button"
            onClick={() => goToStep(2)}
            className={primaryButtonClasses}
          >
            {labels.seeTimes}
          </button>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Step 2: Choose a time                                            */}
      {/* ---------------------------------------------------------------- */}
      {step === 2 ? (
        <div className="p-6">
          <p className="type-metadata text-text-secondary mb-2">{stepLabel(2)}</p>
          <button
            type="button"
            onClick={() => goToStep(1)}
            className={cn(ghostButtonClasses, 'mb-4')}
          >
            {labels.back}
          </button>
          <h3
            ref={step2Ref}
            tabIndex={-1}
            className="type-section-title mb-2 outline-none"
          >
            {labels.chooseTime}
          </h3>
          <p className="type-metadata text-text-secondary mb-4">
            {advisor.name} &middot; {advisor.meta}
          </p>
          <h4 className="type-label mb-2">{dateLabel}</h4>
          <TimeSlotGrid
            slots={slots}
            selectedId={selectedSlotId}
            onSelect={setSelectedSlotId}
            timeZoneLabel={labels.timeZoneLabel}
          />
          <p className="mt-4 type-metadata text-text-secondary">
            {labels.timeZoneLabel}: {timeZone}
          </p>
          <div className="mt-6">
            <button
              type="button"
              disabled={!selectedSlotId}
              onClick={() => goToStep(3)}
              className={primaryButtonClasses}
            >
              {labels.continueLabel}
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Step 3: Review and confirm                                       */}
      {/* ---------------------------------------------------------------- */}
      {step === 3 ? (
        <div className="p-6">
          <p className="type-metadata text-text-secondary mb-2">{stepLabel(3)}</p>
          <button
            type="button"
            onClick={() => goToStep(2)}
            className={cn(ghostButtonClasses, 'mb-4')}
          >
            {labels.back}
          </button>
          <h3
            ref={step3Ref}
            tabIndex={-1}
            className="type-section-title mb-4 outline-none"
          >
            {labels.reviewAndConfirm}
          </h3>

          <div className="mb-4">
            <p className="font-[var(--font-weight-label)]">{advisor.name}</p>
            {selectedSlot ? (
              <p className="type-metadata text-text-secondary">
                {dateLabel} &middot; {selectedSlot.label}
              </p>
            ) : null}
            <p className="type-metadata text-text-secondary">
              {timeZone} &middot; {advisor.meta}
            </p>
          </div>

          <CostBreakdown
            rows={pricing}
            currency="EUR"
            locale="en"
            formatCurrency={formatCurrency}
            labels={{
              price: labels.price,
              employerCovers: labels.employerCovers,
              youPay: labels.youPay,
              timeZone: labels.timeZoneLabel,
              terms: labels.terms,
            }}
            timeZone={timeZone}
            onTermsClick={() => setTermsOpen(true)}
          />

          <div className="mt-6">
            <button
              type="button"
              onClick={handleConfirm}
              className={primaryButtonClasses}
            >
              <ConfirmLabel action={labels.confirm} amount={formatCurrency(pricing.youPay)} />
            </button>
          </div>

          {/* Terms AlertDialog */}
          <AlertDialog open={termsOpen} onOpenChange={setTermsOpen}>
            <AlertDialogContent
              title={labels.termsTitle}
              description={labels.termsBody}
              confirmLabel={labels.termsAccept}
              cancelLabel={labels.termsCancel}
            />
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
}
