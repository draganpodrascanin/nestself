import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Heading, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { ReinstateUserDialog } from './reinstate-user-dialog';
import { SuspendUserDialog } from './suspend-user-dialog';

export interface UserAccountActionsProps {
  opsApi: OpsAdminApi;
  userId: string;
  /** The account state from the access lookup. */
  suspended: boolean;
  /** Sample mode: the buttons are shown but disabled. */
  sampleMode: boolean;
  headingLevel: 3 | 4;
}

/**
 * The looked-up user's account state with Suspend or Reinstate
 * (`people.deactivate`). Shown by effective action; the server enforces the
 * same action and asks for step-up.
 */
export function UserAccountActions({ opsApi, userId, suspended, sampleMode, headingLevel }: UserAccountActionsProps) {
  const { t } = useTranslation(['admin', 'common']);
  const headingId = useId();
  const { principal, effectiveActions } = useAuth();
  const canManage = principal ? can(principal, 'people.deactivate', undefined, effectiveActions) : false;
  const [dialog, setDialog] = useState<'suspend' | 'reinstate' | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const open = (which: 'suspend' | 'reinstate') => {
    setDialogKey((k) => k + 1);
    setDialog(which);
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <Heading level={headingLevel} id={headingId}>
        {t('admin:users.title')}
      </Heading>
      <div className="flex flex-wrap items-center gap-3">
        <Text>{t('admin:users.stateLabel')}</Text>
        <Badge tone={suspended ? 'danger' : 'success'}>
          {suspended ? t('admin:users.state.suspended') : t('admin:users.state.active')}
        </Badge>
      </div>
      {canManage ? (
        <div className="flex flex-wrap gap-3">
          {suspended ? (
            <Button variant="secondary" disabled={sampleMode} onClick={() => open('reinstate')}>
              {t('admin:users.reinstate.open')}
            </Button>
          ) : (
            <Button variant="danger" disabled={sampleMode} onClick={() => open('suspend')}>
              {t('admin:users.suspend.open')}
            </Button>
          )}
        </div>
      ) : null}

      {canManage && !sampleMode ? (
        <>
          <SuspendUserDialog
            key={`suspend-${dialogKey}`}
            open={dialog === 'suspend'}
            onClose={() => setDialog(null)}
            opsApi={opsApi}
            userId={userId}
          />
          <ReinstateUserDialog
            key={`reinstate-${dialogKey}`}
            open={dialog === 'reinstate'}
            onClose={() => setDialog(null)}
            opsApi={opsApi}
            userId={userId}
          />
        </>
      ) : null}
    </section>
  );
}
