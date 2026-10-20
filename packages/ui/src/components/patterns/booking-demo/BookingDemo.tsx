import { useState, useRef, useEffect, useCallback } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { cn } from '../../../lib/cn';
import { Avatar } from '../avatar/Avatar';
import { TimeSlotGrid } from '../time-slot-grid/TimeSlotGrid';
import { CostBreakdown } from '../cost-breakdown/CostBreakdown';
import { ConfirmLabel } from '../confirm-label/ConfirmLabel';
import type { TimeSlot } from '../time-slot-grid/TimeSlotGrid';
import type { CostBreakdownRows } from '../cost-breakdown/CostBreakdown';

export interface BookingDemoAdvisor {
  name: string;
  initials: string;
  title: string;
}

export interface BookingDemoPricing {
  price: number;
  employerCovers: number;
  youPay: number;
}

export interface BookingDemoLabels {
  step: string;
  chooseSlot: string;
  reviewAndConfirm: string;
  selectTime: string;
  advisorCard: string;
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
}

export interface BookingDemoProps {
  advisor: BookingDemoAdvisor;
  slots: TimeSlot[];
  pricing: BookingDemoPricing;
  timeZone: string;
  labels: BookingDemoLabels;
  formatCurrency: (amount: number) => string;
  onAnnounce?: (message: string) => void;
  className?: string;
}

export function BookingDemo({
  advisor,
  slots,
  pricing,
  timeZone,
  labels,
  formatCurrency,
  onAnnounce,
  className,
}: BookingDemoProps) {
  const [step, setStep] = useState(1);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);

  const step1Ref = useRef<HTMLHeadingElement>(null);
  const step2Ref = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const focusHeading = useCallback((ref: React.RefObject<HTMLHeadingElement | null>) => {
    requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true });
    });
  }, []);

  const goToStep = useCallback((nextStep: number) => {
    setStep(nextStep);
  }, []);

  useEffect(() => {
    if (step === 1) focusHeading(step1Ref);
    if (step === 2) focusHeading(step2Ref);
  }, [step, focusHeading]);

  const handleConfirm = () => {
    setStep(3);
    onAnnounce?.(labels.doneAnnouncement);
    requestAnimationFrame(() => {
      doneRef.current?.focus({ preventScroll: true });
    });
  };

  const handleReset = () => {
    setSelectedSlotId(null);
    setStep(1);
  };

  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const stepLabel = (n: number) => `${labels.step} ${n} of 3`;

  if (step === 3) {
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
          className={cn(
            'inline-flex items-center justify-center min-h-11 px-5 py-2.5 rounded-control border border-border-control bg-surface text-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            'hover:bg-tint',
            'pointer-coarse:min-h-12',
          )}
        >
          {labels.reset}
        </button>
      </div>
    );
  }

  return (
    <div className={cn('border border-border-subtle rounded-card bg-surface', className)}>
      {/* Step 1: Advisor card */}
      {step === 1 ? (
        <div className="p-6">
          <p className="type-metadata text-text-secondary mb-2">{stepLabel(1)}</p>
          <h3
            ref={step1Ref}
            tabIndex={-1}
            className="type-section-title mb-4 outline-none"
          >
            {labels.advisorCard}
          </h3>
          <div className="flex items-center gap-4 mb-6">
            <Avatar initials={advisor.initials} name={advisor.name} size="md" />
            <div>
              <p className="font-[var(--font-weight-label)]">{advisor.name}</p>
              <p className="type-metadata text-text-secondary">{advisor.title}</p>
            </div>
          </div>

          <h4 className="type-label mb-2">{labels.selectTime}</h4>
          <TimeSlotGrid
            slots={slots}
            selectedId={selectedSlotId}
            onSelect={setSelectedSlotId}
            timeZoneLabel={labels.timeZoneLabel}
          />

          <div className="mt-6">
            <button
              type="button"
              disabled={!selectedSlotId}
              onClick={() => goToStep(2)}
              className={cn(
                'inline-flex items-center justify-center w-full min-h-11 px-5 py-2.5 rounded-control border border-transparent bg-primary text-on-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
                'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                'disabled:bg-disabled-surface disabled:text-disabled-text disabled:cursor-not-allowed',
                'pointer-coarse:min-h-12',
              )}
            >
              {labels.continueLabel}
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 2: Review and confirm */}
      {step === 2 ? (
        <div className="p-6">
          <p className="type-metadata text-text-secondary mb-2">{stepLabel(2)}</p>
          <h3
            ref={step2Ref}
            tabIndex={-1}
            className="type-section-title mb-4 outline-none"
          >
            {labels.reviewAndConfirm}
          </h3>

          <div className="flex items-center gap-4 mb-4">
            <Avatar initials={advisor.initials} name={advisor.name} size="sm" />
            <div>
              <p className="font-[var(--font-weight-label)]">{advisor.name}</p>
              {selectedSlot ? (
                <p className="type-metadata text-text-secondary">{selectedSlot.label}</p>
              ) : null}
            </div>
          </div>

          <CostBreakdown
            rows={pricing as CostBreakdownRows}
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

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => goToStep(1)}
              className={cn(
                'inline-flex items-center justify-center min-h-11 px-5 py-2.5 rounded-control border border-border-control bg-surface text-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
                'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                'hover:bg-tint',
                'pointer-coarse:min-h-12',
              )}
            >
              {labels.back}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className={cn(
                'inline-flex items-center justify-center flex-1 min-h-11 px-5 py-2.5 rounded-control border border-transparent bg-primary text-on-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
                'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                'pointer-coarse:min-h-12',
              )}
            >
              <ConfirmLabel action={labels.confirm} amount={formatCurrency(pricing.youPay)} />
            </button>
          </div>

          {/* Terms AlertDialog */}
          <AlertDialog.Root open={termsOpen} onOpenChange={setTermsOpen}>
            <AlertDialog.Portal>
              <AlertDialog.Backdrop className="fixed inset-0 bg-scrim z-50" />
              <AlertDialog.Popup
                className={cn(
                  'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
                  'w-[min(calc(100%-2rem),37rem)] max-h-[min(85vh,52rem)] overflow-auto',
                  'p-8 border border-border-subtle rounded-modal bg-surface text-text shadow-modal',
                )}
              >
                <AlertDialog.Title className="type-section-title mb-5">
                  {labels.termsTitle}
                </AlertDialog.Title>
                <AlertDialog.Description className="text-text-secondary type-body">
                  {labels.termsBody}
                </AlertDialog.Description>
                <div className="flex justify-end gap-3 flex-wrap mt-7">
                  <AlertDialog.Close
                    className={cn(
                      'inline-flex items-center justify-center min-h-11 px-5 py-2.5 rounded-control border border-border-control bg-surface text-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
                      'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                      'hover:bg-tint',
                      'pointer-coarse:min-h-12',
                    )}
                  >
                    {labels.termsCancel}
                  </AlertDialog.Close>
                  <AlertDialog.Close
                    className={cn(
                      'inline-flex items-center justify-center min-h-11 px-5 py-2.5 rounded-control border border-transparent bg-primary text-on-primary font-[var(--font-weight-label)] type-body transition-colors duration-[var(--motion-fast)]',
                      'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                      'pointer-coarse:min-h-12',
                    )}
                  >
                    {labels.termsAccept}
                  </AlertDialog.Close>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      ) : null}
    </div>
  );
}
