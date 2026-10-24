import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { AccessScreen } from '../../../../features/access/access-screen';
import { orgAdminApi } from '../../../../features/access/use-org-admin';
import { isSampleDataMode } from '../../../../data-source';

export const Route = createFileRoute('/_authenticated/_hr/hr/access')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (!principal || !can(principal, 'access.preview', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'hr' } });
    }
  },
  component: AccessPage,
});

function AccessPage() {
  return <AccessScreen adminApi={orgAdminApi} sampleMode={isSampleDataMode} />;
}
