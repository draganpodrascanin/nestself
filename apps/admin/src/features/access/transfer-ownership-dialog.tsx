import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  FormErrorSummary,
  Select,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { OpsAdminApi } from '@nestself/api-client';
import { transferErrorKey } from './access-errors';
import type { AccessMember } from './access-labels';
import { useTransferOwnership } from './use-ops-admin';

const IDS = {
  member: 'transfer-member',
  form: 'transfer-form',
} as const;

export interface TransferOwnershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opsApi: OpsAdminApi;
  orgId: string;
  /** Active members who can become the owner (the current owner is left out). */
  members: readonly AccessMember[];
  /** Display name of the current owner; `null` when the organization has none. */
  currentOwnerName: string | null;
}

/**
 * Staff sets the organization owner through the operations route. The server
 * revokes the current owner grant (if any) and creates the new one in the
 * same transaction.
 */
export function TransferOwnershipDialog({
  open,
  onOpenChange,
  opsApi,
  orgId,
  members,
  currentOwnerName,
}: TransferOwnershipDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const transfer = useTransferOwnership(opsApi, orgId);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);

  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const reset = () => {
    setMemberId(null);
    setErrors([]);
    onOpenChange(false);
  };

  const close = () => {
    if (transfer.isPending) return;
    reset();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (transfer.isPending) return;
    if (!memberId) {
      setErrors([{ id: IDS.member, label: t('admin:access.transfer.member'), message: t('admin:access.errors.memberRequired') }]);
      return;
    }
    setErrors([]);
    try {
      await transfer.mutateAsync({ newOwnerUserId: memberId });
      addToast({ title: t('admin:access.transfer.success'), tone: 'success' });
      reset();
    } catch (err) {
      const key = transferErrorKey(err);
      if (key === null) {
        reset();
        return;
      }
      const onMember = key === 'subjectNotMember' || key === 'alreadyOwner';
      setErrors([
        {
          id: onMember ? IDS.member : IDS.form,
          label: onMember ? t('admin:access.transfer.member') : t('admin:access.transfer.title'),
          message: t(`admin:access.errors.${key}`),
        },
      ]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        title={t('admin:access.transfer.title')}
        description={t('admin:access.transfer.description')}
        closeLabel={t('common:nav.close')}
      >
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <Field id={IDS.member} label={t('admin:access.transfer.member')} error={errorFor(IDS.member)} required>
            <Select
              options={members.map((m) => ({ value: m.userId, label: m.displayName }))}
              placeholder={t('admin:access.assign.choose')}
              onValueChange={setMemberId}
            />
          </Field>
          <Alert tone="info">
            {currentOwnerName === null
              ? t('admin:access.transfer.noOwner')
              : t('admin:access.transfer.currentOwner', { name: currentOwnerName })}
          </Alert>
          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={transfer.isPending}>
              {t('admin:access.transfer.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={transfer.isPending}>
              {t('admin:access.transfer.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
