import { createFileRoute } from '@tanstack/react-router';
import { opsAdminApi } from '../../../features/access/use-ops-admin';
import { EmergencyScreen } from '../../../features/emergency/emergency-screen';
import { isSampleDataMode } from '../../../data-source';

function EmergencyPage() {
  return <EmergencyScreen opsApi={opsAdminApi} sampleMode={isSampleDataMode} />;
}

export const Route = createFileRoute('/_authenticated/emergency/')({
  component: EmergencyPage,
});
