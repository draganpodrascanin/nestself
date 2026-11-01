import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBlock } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth } from '../../auth';

/**
 * Shows a listening operations page only to principals holding the action it
 * needs. A convenience: the `/ops/listening/*` and
 * `/ops/orgs/:orgId/listening/*` routes enforce the same action on the server.
 */
export function ListeningGate({ action, children }: { action: string; children: ReactNode }) {
  const { t } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  if (!principal || !can(principal, action, undefined, effectiveActions)) {
    return <StatusBlock state="permission" title={t('state.permission.title')} body={t('state.permission.body')} />;
  }
  return <>{children}</>;
}
