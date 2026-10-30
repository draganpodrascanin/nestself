import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDialog, AlertDialogContent, useToast } from '@nestself/ui';
import type { InvitationResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { peopleErrorKey } from './people-errors';
import type { PeopleErrorKey } from './people-errors';
import { useRevokeInvitation } from './use-people';

export interface RevokeInvitationDialogProps {
  /** The invitation to revoke; `null` keeps the dialog closed. */
  invitation: InvitationResponse | null;
  onClose: () => void;
  adminApi: OrgAdminApi;
  orgId: string;
}

export function RevokeInvitationDialog({ invitation, onClose, adminApi, orgId }: RevokeInvitationDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const revoke = useRevokeInvitation(adminApi, orgId);
  const [error, setError] = useState<PeopleErrorKey | null>(null);
  /** Ignores the dialog's own close request while a confirm is handled, so a failure stays visible. */
  const confirming = useRef(false);

  const close = () => {
    setError(null);
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (confirming.current || revoke.isPending) return;
    close();
  };

  const confirm = async () => {
    if (!invitation || revoke.isPending) return;
    setError(null);
    try {
      await revoke.mutateAsync(invitation.id);
      addToast({ title: t('workspace:people.revoke.success', { email: invitation.email }), tone: 'success' });
      close();
    } catch (err) {
      const key = peopleErrorKey(err);
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
    <AlertDialog open={invitation !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        title={t('workspace:people.revoke.title')}
        description={invitation ? t('workspace:people.revoke.description', { email: invitation.email }) : undefined}
        confirmLabel={t('workspace:people.revoke.confirm')}
        cancelLabel={t('workspace:people.cancel')}
        destructive
        onConfirm={handleConfirm}
        confirmPending={revoke.isPending}
      >
        {error ? <Alert tone="danger">{t(`workspace:people.errors.${error}`)}</Alert> : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
