import { createFileRoute } from '@tanstack/react-router';
import { opsAdminApi } from '../../../features/access/use-ops-admin';
import { OrganizationsScreen } from '../../../features/organizations/organizations-screen';
import { isSampleDataMode } from '../../../data-source';

function OrganizationsPage() {
  return <OrganizationsScreen opsApi={opsAdminApi} sampleMode={isSampleDataMode} />;
}

export const Route = createFileRoute('/_authenticated/organizations/')({
  component: OrganizationsPage,
});
