import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDialog, AlertDialogContent, useToast } from '@nestself/ui';
import type { EmergencyAccessResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { emergencyErrorKey } from './emergency-errors';
import type { EmergencyErrorKey } from './emergency-errors';
import { useEmergencyDecision } from './use-emergency';
import type { EmergencyDecision } from './use-emergency';

export interface DecisionDialogProps {
  decision: EmergencyDecision;
  /** The record to decide on; `null` keeps the dialog closed. */
  row: EmergencyAccessResponse | null;
  onClose: () => void;
  opsApi: OpsAdminApi;
}

/**
 * Confirms approving or denying a pending request, or revoking an active
 * window (`access.emergency.approve`, emergency step-up). A failure stays in
 * the dialog as translated copy; a cancelled step-up closes it quietly.
 */
export function DecisionDialog({ decision, row, onClose, opsApi }: DecisionDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const mutation = useEmergencyDecision(opsApi, decision);
  const [error, setError] = useState<EmergencyErrorKey | null>(null);
  /** Ignores the dialog's own close request while a confirm is handled, so a failure stays visible. */
  const confirming = useRef(false);

  const close = () => {
    setError(null);
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (confirming.current || mutation.isPending) return;
    close();
  };

  const confirm = async () => {
    if (!row || mutation.isPending) return;
    setError(null);
    try {
      await mutation.mutateAsync(row.id);
      addToast({ title: t(`admin:emergency.${decision}.success`), tone: 'success' });
      close();
    } catch (err) {
      const key = emergencyErrorKey(err);
      if (key === null) close();
      else setError(key);
    }
  };

  const handleConfirm = () => {
    confirming.current = true;
    queueMicrotask(() => {
      confirming.current = false;
    });
    void confirm();
  };

  return (
    <AlertDialog open={row !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        title={t(`admin:emergency.${decision}.title`)}
        description={
          row
            ? t(`admin:emergency.${decision}.description`, {
                requester: row.userId,
                scope: t(`admin:emergency.scopeKinds.${row.scopeKind}`),
                scopeId: row.scopeId,
              })
            : undefined
        }
        confirmLabel={t(`admin:emergency.${decision}.confirm`)}
        cancelLabel={t('admin:emergency.cancel')}
        destructive={decision !== 'approve'}
        onConfirm={handleConfirm}
        confirmPending={mutation.isPending}
      >
        {row ? (
          <p className="type-body text-text">
            <span className="text-text-secondary">{t('admin:emergency.purpose')}: </span>
            {row.purpose}
          </p>
        ) : null}
        {error ? <Alert tone="danger">{t(`admin:emergency.errors.${error}`)}</Alert> : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
