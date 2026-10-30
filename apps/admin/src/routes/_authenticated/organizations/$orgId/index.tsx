import { createFileRoute } from '@tanstack/react-router';
import { opsAdminApi } from '../../../../features/access/use-ops-admin';
import { OrgOverviewScreen } from '../../../../features/organizations/org-overview-screen';
import { isSampleDataMode } from '../../../../data-source';

function OrgOverviewPage() {
  const { orgId } = Route.useParams();
  return <OrgOverviewScreen opsApi={opsAdminApi} orgId={orgId} sampleMode={isSampleDataMode} />;
}

export const Route = createFileRoute('/_authenticated/organizations/$orgId/')({
  component: OrgOverviewPage,
});
