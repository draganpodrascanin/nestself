import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormErrorSummary,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { OrgAdminApi } from '@nestself/api-client';
import { transferErrorKey } from './access-errors';
import { MemberPicker } from './member-picker';
import { useTransferOwnership } from './use-org-admin';

const IDS = {
  member: 'transfer-member',
  form: 'transfer-form',
} as const;

export interface TransferOwnershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminApi: OrgAdminApi;
  orgId: string;
  /** The current owner, who is left out of the members who can become the owner. */
  currentUserId: string;
}

/**
 * The current owner hands `employer_owner` to another active member. The
 * server revokes the caller's owner grant in the same transaction, so the
 * dialog says so before the caller confirms.
 */
export function TransferOwnershipDialog({ open, onOpenChange, adminApi, orgId, currentUserId }: TransferOwnershipDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const transfer = useTransferOwnership(adminApi, orgId);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);

  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const close = () => {
    if (transfer.isPending) return;
    setMemberId(null);
    setErrors([]);
    onOpenChange(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (transfer.isPending) return;
    if (!memberId) {
      setErrors([{ id: IDS.member, label: t('workspace:access.transfer.member'), message: t('workspace:access.errors.memberRequired') }]);
      return;
    }
    setErrors([]);
    try {
      await transfer.mutateAsync({ newOwnerUserId: memberId });
      addToast({ title: t('workspace:access.transfer.success'), tone: 'success' });
      setMemberId(null);
      onOpenChange(false);
    } catch (err) {
      const key = transferErrorKey(err);
      if (key === null) {
        setMemberId(null);
        onOpenChange(false);
        return;
      }
      const onMember = key === 'subjectNotMember' || key === 'alreadyOwner';
      setErrors([
        {
          id: onMember ? IDS.member : IDS.form,
          label: onMember ? t('workspace:access.transfer.member') : t('workspace:access.transfer.title'),
          message: t(`workspace:access.errors.${key}`),
        },
      ]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        title={t('workspace:access.transfer.title')}
        description={t('workspace:access.transfer.description')}
        closeLabel={t('common:nav.close')}
      >
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <MemberPicker
            adminApi={adminApi}
            orgId={orgId}
            id={IDS.member}
            label={t('workspace:access.transfer.member')}
            placeholder={t('workspace:access.assign.choose')}
            required
            error={errorFor(IDS.member)}
            excludeUserId={currentUserId}
            onValueChange={setMemberId}
          />
          <Alert tone="info">{t('workspace:access.transfer.confirmation')}</Alert>
          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={transfer.isPending}>
              {t('workspace:access.transfer.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={transfer.isPending}>
              {t('workspace:access.transfer.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
