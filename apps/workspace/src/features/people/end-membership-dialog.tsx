import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertDialog, AlertDialogContent, Field, FormErrorSummary, Select, useToast } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { MemberItem, MembershipEndedReason } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { peopleErrorKey } from './people-errors';
import { END_REASONS } from './people-labels';
import { useEndMember } from './use-people';

const REASON_ID = 'end-reason';

export interface EndMembershipDialogProps {
  /** The member whose membership ends; `null` keeps the dialog closed. */
  member: MemberItem | null;
  onClose: () => void;
  adminApi: OrgAdminApi;
  orgId: string;
}

/**
 * Ends a membership (`people.deactivate`, step-up class administration). A
 * `step_up_required` answer opens the step-up dialog through `withStepUp`
 * and the call is retried once; a cancelled step-up closes quietly.
 */
export function EndMembershipDialog(props: EndMembershipDialogProps) {
  return <EndMembershipForm key={props.member?.membershipId ?? 'closed'} {...props} />;
}

function EndMembershipForm({ member, onClose, adminApi, orgId }: EndMembershipDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const endMember = useEndMember(adminApi, orgId);
  const [reason, setReason] = useState<MembershipEndedReason>('DEACTIVATED_BY_HR');
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

  const confirm = async () => {
    if (!member || endMember.isPending) return;
    setErrors([]);
    try {
      await endMember.mutateAsync({ membershipId: member.membershipId, reason });
      addToast({ title: t('workspace:people.end.success', { name: member.displayName }), tone: 'success' });
      close();
    } catch (err) {
      const key = peopleErrorKey(err);
      if (key === null) close();
      else setErrors([{ id: REASON_ID, label: t('workspace:people.end.reason'), message: t(`workspace:people.errors.${key}`) }]);
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
        title={t('workspace:people.end.title')}
        description={member ? t('workspace:people.end.description', { name: member.displayName }) : undefined}
        confirmLabel={t('workspace:people.end.confirm')}
        cancelLabel={t('workspace:people.cancel')}
        destructive
        onConfirm={handleConfirm}
        confirmPending={endMember.isPending}
      >
        <div className="space-y-4">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <Field id={REASON_ID} label={t('workspace:people.end.reason')} error={errors[0]?.message} required>
            <Select
              options={END_REASONS.map((r) => ({ value: r, label: t(`workspace:people.end.reasons.${r}`) }))}
              value={reason}
              onValueChange={(v) => {
                if (v) setReason(v as MembershipEndedReason);
              }}
            />
          </Field>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
