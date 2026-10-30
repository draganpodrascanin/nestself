import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertDialog, AlertDialogContent, Field, FormErrorSummary, Select, useToast } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { MemberItem, MembershipEndedReason } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { peopleErrorKey } from './people-errors';
import { END_REASONS } from './people-labels';
import { useEndMember } from './use-ops-people';

const REASON_ID = 'end-reason';

export interface EndMembershipDialogProps {
  /** The member whose membership ends; `null` keeps the dialog closed. */
  member: MemberItem | null;
  onClose: () => void;
  opsApi: OpsAdminApi;
  orgId: string;
}

/**
 * Ends a membership through the operations route (`people.deactivate`,
 * step-up class administration). The reason must be chosen; a
 * `step_up_required` answer opens the step-up dialog through `withStepUp` and
 * the call is retried once; a cancelled step-up closes quietly.
 */
export function EndMembershipDialog(props: EndMembershipDialogProps) {
  return <EndMembershipForm key={props.member?.membershipId ?? 'closed'} {...props} />;
}

function EndMembershipForm({ member, onClose, opsApi, orgId }: EndMembershipDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const endMember = useEndMember(opsApi, orgId);
  const [reason, setReason] = useState<MembershipEndedReason | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);
  /**
   * The confirm button of `AlertDialogContent` also closes the dialog. While
   * a confirm is being handled that close is ignored, so a failure stays on
   * screen.
   */
  const confirming = useRef(false);

  const close = () => {
    setErrors([]);
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (confirming.current || endMember.isPending) return;
    close();
  };

  const fail = (message: string) => setErrors([{ id: REASON_ID, label: t('admin:people.end.reason'), message }]);

  const confirm = async () => {
    if (!member || endMember.isPending) return;
    if (!reason) {
      fail(t('admin:people.errors.reasonRequired'));
      return;
    }
    setErrors([]);
    try {
      await endMember.mutateAsync({ membershipId: member.membershipId, reason });
      addToast({ title: t('admin:people.end.success', { name: member.displayName }), tone: 'success' });
      close();
    } catch (err) {
      const key = peopleErrorKey(err);
      if (key === null) close();
      else fail(t(`admin:people.errors.${key}`));
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
    <AlertDialog open={member !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        title={t('admin:people.end.title')}
        description={member ? t('admin:people.end.description', { name: member.displayName }) : undefined}
        confirmLabel={t('admin:people.end.confirm')}
        cancelLabel={t('admin:people.cancel')}
        destructive
        onConfirm={handleConfirm}
        confirmPending={endMember.isPending}
      >
        <div className="space-y-4">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <Field id={REASON_ID} label={t('admin:people.end.reason')} error={errors[0]?.message} required>
            <Select
              options={END_REASONS.map((r) => ({ value: r, label: t(`admin:people.end.reasons.${r}`) }))}
              placeholder={t('admin:people.choose')}
              onValueChange={(v) => setReason((v as MembershipEndedReason | null) ?? null)}
            />
          </Field>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
