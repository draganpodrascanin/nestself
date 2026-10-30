import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertDialog, AlertDialogContent, Field, FormErrorSummary, Textarea, useToast } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { UserSuspendRequestSchema } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { userErrorKey } from './user-errors';
import { useSuspendUser } from './use-users';

const REASON_ID = 'suspend-reason';

export interface SuspendUserDialogProps {
  open: boolean;
  onClose: () => void;
  opsApi: OpsAdminApi;
  userId: string;
}

/**
 * Suspends a user with a written reason. The server signs the user out
 * everywhere and disables their sign-in; a `step_up_required` answer opens
 * the step-up dialog through `withStepUp` and the call is retried once.
 */
export function SuspendUserDialog({ open, onClose, opsApi, userId }: SuspendUserDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const suspend = useSuspendUser(opsApi, userId);
  const formRef = useRef<HTMLFormElement>(null);
  /** Ignores the dialog's own close request while a confirm is handled, so a failure stays visible. */
  const confirming = useRef(false);
  const [errors, setErrors] = useState<FormError[]>([]);

  const close = () => {
    setErrors([]);
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (confirming.current || suspend.isPending) return;
    close();
  };

  const fail = (message: string) => setErrors([{ id: REASON_ID, label: t('admin:access.reason.label'), message }]);

  const confirm = async () => {
    if (suspend.isPending) return;
    const reason = String(new FormData(formRef.current ?? undefined).get('reason') ?? '').trim();
    if (!UserSuspendRequestSchema.shape.reason.safeParse(reason).success) {
      fail(t('admin:access.errors.reasonLength'));
      return;
    }
    setErrors([]);
    try {
      await suspend.mutateAsync(reason);
      addToast({ title: t('admin:users.suspend.success', { userId }), tone: 'success' });
      close();
    } catch (err) {
      const key = userErrorKey(err);
      if (key === null) close();
      else fail(t(`admin:users.errors.${key}`));
    }
  };

  const handleConfirm = () => {
    confirming.current = true;
    // Released after the dialog's own close request in this click has been ignored.
    queueMicrotask(() => {
      confirming.current = false;
    });
    void confirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        title={t('admin:users.suspend.title')}
        description={t('admin:users.suspend.description', { userId })}
        confirmLabel={t('admin:users.suspend.confirm')}
        cancelLabel={t('admin:users.cancel')}
        destructive
        onConfirm={handleConfirm}
        confirmPending={suspend.isPending}
      >
        <form ref={formRef} noValidate onSubmit={(e) => e.preventDefault()} className="space-y-4">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <Field
            id={REASON_ID}
            label={t('admin:access.reason.label')}
            description={t('admin:access.reason.hint')}
            error={errors[0]?.message}
            required
          >
            <Textarea name="reason" rows={3} />
          </Field>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
