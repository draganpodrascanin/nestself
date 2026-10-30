import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { OrgUnitsScreen } from '../../../../features/org-units/org-units-screen';
import { orgAdminApi } from '../../../../features/access/use-org-admin';
import { isSampleDataMode } from '../../../../data-source';
import { resolveRouteAuth } from '../../../../auth';

export const Route = createFileRoute('/_authenticated/_hr/hr/org-units')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'org_units.manage', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'hr' } });
    }
  },
  component: OrgUnitsPage,
});

function OrgUnitsPage() {
  return <OrgUnitsScreen adminApi={orgAdminApi} sampleMode={isSampleDataMode} />;
}
