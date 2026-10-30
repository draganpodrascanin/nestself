/**
 * "Cancel appointment" (CALL-27) for coordinators and operations, behind a confirmation dialog, which animates
 * in and out through `@nestself/ui` (Motion rule). The server decides
 * (`appointment.cancel` on the appointment); the outcome, success or the
 * translated failure, stays on screen after the dialog closes. Sample mode
 * sends nothing and says so.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDialog, AlertDialogContent, AlertDialogTrigger, Button } from '@nestself/ui';
import { appointmentKeys } from '@nestself/api-client';
import type { Appointment } from '@nestself/contracts';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { useZonedFormat } from './format';
import { mapCallError } from './map-call-error';
import { Reveal } from './reveal';

/** A confirmed appointment that has not ended yet can be canceled. */
export function isCancelable(appointment: Pick<Appointment, 'status' | 'endsAt'>, now: number): boolean {
  return appointment.status === 'confirmed' && Date.parse(appointment.endsAt) > now;
}

export function CancelAppointment({ appointment, onCanceled }: { appointment: Appointment; onCanceled?: (updated: Appointment) => void }) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const queryClient = useQueryClient();
  const [now] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'info' | 'danger'; message: string } | null>(null);

  const cancel = async () => {
    setResult(null);
    if (isSampleDataMode) {
      setResult({ tone: 'info', message: t('sample.actionNoop') });
      return;
    }
    setPending(true);
    try {
      const updated = await callsApi.cancel(appointment.id);
      queryClient.setQueryData(appointmentKeys.detail(appointment.id), (current: object | undefined) => ({ ...current, ...updated }));
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
      setResult({ tone: 'success', message: t('cancel.done') });
      onCanceled?.(updated);
    } catch (err) {
      setResult({ tone: 'danger', message: mapCallError(err, t) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gap-3 flex flex-col items-start">
      {isCancelable(appointment, now) ? (
        <AlertDialog>
          <AlertDialogTrigger>
            <Button variant="secondary" loading={pending} loadingLabel={t('cancel.button')}>
              {t('cancel.button')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            title={t('cancel.title')}
            description={t('cancel.body', {
              date: format.date(appointment.startsAt, appointment.timeZone),
              time: format.time(appointment.startsAt, appointment.timeZone),
            })}
            confirmLabel={t('cancel.confirm')}
            cancelLabel={t('cancel.keep')}
            destructive
            onConfirm={() => void cancel()}
          />
        </AlertDialog>
      ) : null}
      <Reveal show={result !== null}>
        <Alert tone={result?.tone ?? 'info'}>{result?.message}</Alert>
      </Reveal>
    </div>
  );
}
