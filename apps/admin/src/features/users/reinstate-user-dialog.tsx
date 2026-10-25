import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDialog, AlertDialogContent, useToast } from '@nestself/ui';
import type { OpsAdminApi } from '@nestself/api-client';
import { userErrorKey } from './user-errors';
import type { UserErrorKey } from './user-errors';
import { useReinstateUser } from './use-users';

export interface ReinstateUserDialogProps {
  open: boolean;
  onClose: () => void;
  opsApi: OpsAdminApi;
  userId: string;
}

/** Lifts a suspension after a confirmation, through `withStepUp`. */
export function ReinstateUserDialog({ open, onClose, opsApi, userId }: ReinstateUserDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const reinstate = useReinstateUser(opsApi, userId);
  const [error, setError] = useState<UserErrorKey | null>(null);
  /** Ignores the dialog's own close request while a confirm is handled, so a failure stays visible. */
  const confirming = useRef(false);

  const close = () => {
    setError(null);
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (confirming.current || reinstate.isPending) return;
    close();
  };

  const confirm = async () => {
    if (reinstate.isPending) return;
    setError(null);
    try {
      await reinstate.mutateAsync();
      addToast({ title: t('admin:users.reinstate.success', { userId }), tone: 'success' });
      close();
    } catch (err) {
      const key = userErrorKey(err);
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
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        title={t('admin:users.reinstate.title')}
        description={t('admin:users.reinstate.description', { userId })}
        confirmLabel={t('admin:users.reinstate.confirm')}
        cancelLabel={t('admin:users.cancel')}
        onConfirm={handleConfirm}
        confirmPending={reinstate.isPending}
      >
        {error ? <Alert tone="danger">{t(`admin:users.errors.${error}`)}</Alert> : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
