import { createFileRoute } from '@tanstack/react-router';
import { AccessGate } from '../../../../features/access/access-gate';
import { OrgAccessScreen } from '../../../../features/access/org-access-screen';
import { opsAdminApi } from '../../../../features/access/use-ops-admin';
import { isSampleDataMode } from '../../../../data-source';

function OrgAccessPage() {
  const { orgId } = Route.useParams();
  return (
    <AccessGate>
      <OrgAccessScreen opsApi={opsAdminApi} orgId={orgId} sampleMode={isSampleDataMode} />
    </AccessGate>
  );
}

export const Route = createFileRoute('/_authenticated/organizations/$orgId/access')({
  component: OrgAccessPage,
});
