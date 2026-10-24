import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogContent,
  Field,
  FormErrorSummary,
  Textarea,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { GrantResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { accessErrorKey } from './access-errors';
import { useRevokeGrant } from './use-org-admin';

const REASON_MIN = 3;
const REASON_MAX = 500;
const REASON_ID = 'revoke-reason';

export interface RevokeGrantDialogProps {
  /** The grant to revoke; `null` keeps the dialog closed. */
  grant: GrantResponse | null;
  templateName: string;
  subjectName: string;
  onClose: () => void;
  adminApi: OrgAdminApi;
  orgId: string;
}

export function RevokeGrantDialog({
  grant,
  templateName,
  subjectName,
  onClose,
  adminApi,
  orgId,
}: RevokeGrantDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const revokeGrant = useRevokeGrant(adminApi, orgId);
  const formRef = useRef<HTMLFormElement>(null);
  /**
   * The confirm button of `AlertDialogContent` also closes the dialog. While
   * a confirm is being handled that close is ignored, so a failure stays on
   * screen next to the reason.
   */
  const confirming = useRef(false);
  const [errors, setErrors] = useState<FormError[]>([]);

  const close = () => {
    setErrors([]);
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (confirming.current || revokeGrant.isPending) return;
    close();
  };

  const fail = (message: string) =>
    setErrors([{ id: REASON_ID, label: t('workspace:access.reason.label'), message }]);

  const confirm = async () => {
    if (!grant || revokeGrant.isPending) return;
    const reason = String(new FormData(formRef.current ?? undefined).get('reason') ?? '').trim();
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
      fail(t('workspace:access.errors.reasonLength'));
      return;
    }
    setErrors([]);
    try {
      await revokeGrant.mutateAsync({ grantId: grant.id, reason });
      addToast({ title: t('workspace:access.revoke.success'), tone: 'success' });
      close();
    } catch (err) {
      const key = accessErrorKey(err);
      if (key === null) close();
      else fail(t(`workspace:access.errors.${key}`));
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
    <AlertDialog open={grant !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        title={t('workspace:access.revoke.title')}
        description={t('workspace:access.revoke.description', {
          subject: subjectName,
          template: templateName,
        })}
        confirmLabel={t('workspace:access.revoke.confirm')}
        cancelLabel={t('workspace:access.revoke.cancel')}
        destructive
        onConfirm={handleConfirm}
        confirmPending={revokeGrant.isPending}
      >
        <form ref={formRef} noValidate onSubmit={(e) => e.preventDefault()} className="space-y-4">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <Field
            id={REASON_ID}
            label={t('workspace:access.reason.label')}
            description={t('workspace:access.reason.hint')}
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
