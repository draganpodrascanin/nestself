/**
 * The expert records what happened in a session (CALL-23): one of the five
 * delivery statuses and nothing else. There is no notes field, by design
 * (D-22, D-CW-25, CW-R-21). The dialog animates in and out through the
 * `@nestself/ui` Dialog (Motion rule).
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogActions, DialogContent, FormErrorSummary, RadioGroup, RadioItem } from '@nestself/ui';
import type { FormError, FormErrorSummaryHandle } from '@nestself/ui';
import { appointmentKeys } from '@nestself/api-client';
import type { AppointmentView } from '@nestself/api-client';
import { CALL_OUTCOME_STATUSES, CallOutcomeStatusSchema } from '@nestself/contracts';
import type { Appointment, CallOutcomeStatus } from '@nestself/contracts';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { mapCallError } from './map-call-error';
import { Reveal } from './reveal';

const OUTCOME_FIELD_ID = 'outcome-status';

export interface OutcomeDialogProps {
  appointmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The outcome was saved (or, in sample mode, would have been). */
  onRecorded: (status: CallOutcomeStatus, appointment: Appointment | null) => void;
}

export function OutcomeDialog({ appointmentId, open, onOpenChange, onRecorded }: OutcomeDialogProps) {
  const { t } = useTranslation('calls');
  const queryClient = useQueryClient();
  const summaryRef = useRef<FormErrorSummaryHandle>(null);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [pending, setPending] = useState(false);

  const fail = (message: string) => {
    setErrors([{ id: OUTCOME_FIELD_ID, label: t('outcome.label'), message }]);
    queueMicrotask(() => summaryRef.current?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = CallOutcomeStatusSchema.safeParse(status);
    if (!parsed.success) {
      fail(t('outcome.required'));
      return;
    }
    setErrors([]);
    if (isSampleDataMode) {
      onRecorded(parsed.data, null);
      onOpenChange(false);
      return;
    }
    setPending(true);
    try {
      const updated = await callsApi.recordOutcome(appointmentId, { status: parsed.data });
      // The outcome answers the seam only, without the participants' names: keep what the page
      // loaded (names, viewer) and refetch the detail, never replace it with the bare payload.
      queryClient.setQueryData<AppointmentView>(appointmentKeys.detail(appointmentId), (current) => (current ? { ...current, ...updated } : current));
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.detail(appointmentId) });
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
      onRecorded(parsed.data, updated);
      onOpenChange(false);
    } catch (err) {
      fail(mapCallError(err, t));
    } finally {
      setPending(false);
    }
  };

  const fieldError = errors[0]?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('outcome.title')} description={t('outcome.description')} closeLabel={t('outcome.cancel')}>
        <form noValidate onSubmit={(event) => void submit(event)} className="gap-4 flex flex-col">
          <Reveal show={errors.length > 0}>
            <FormErrorSummary ref={summaryRef} title={t('outcome.errorSummary')} errors={errors} />
          </Reveal>
          <div id={OUTCOME_FIELD_ID} tabIndex={-1} className="gap-1.5 flex flex-col">
            <RadioGroup label={t('outcome.label')} name="status" value={status} onValueChange={setStatus} className="gap-1 flex flex-col">
              {CALL_OUTCOME_STATUSES.map((value) => (
                <RadioItem key={value} value={value}>
                  {t(`outcome.status.${value}`)}
                </RadioItem>
              ))}
            </RadioGroup>
            {fieldError ? <p className="type-metadata text-danger">{fieldError}</p> : null}
          </div>
          <DialogActions>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              {t('outcome.cancel')}
            </Button>
            <Button type="submit" loading={pending} loadingLabel={t('outcome.submit')}>
              {t('outcome.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
