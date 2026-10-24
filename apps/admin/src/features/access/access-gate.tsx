import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBlock } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth } from '../../auth';

/**
 * Shows the access pages only to principals holding `access.preview`. This is
 * a convenience: the `/ops/*` routes enforce the same action on the server.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  if (!principal || !can(principal, 'access.preview', undefined, effectiveActions)) {
    return <StatusBlock state="permission" title={t('state.permission.title')} body={t('state.permission.body')} />;
  }
  return <>{children}</>;
}
