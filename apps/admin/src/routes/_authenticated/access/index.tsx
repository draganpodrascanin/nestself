import { createFileRoute } from '@tanstack/react-router';
import { AccessGate } from '../../../features/access/access-gate';
import { PlatformAccessScreen } from '../../../features/access/platform-access-screen';
import { opsAdminApi } from '../../../features/access/use-ops-admin';
import { isSampleDataMode } from '../../../data-source';

function PlatformAccessPage() {
  return (
    <AccessGate>
      <PlatformAccessScreen opsApi={opsAdminApi} sampleMode={isSampleDataMode} />
    </AccessGate>
  );
}

export const Route = createFileRoute('/_authenticated/access/')({
  component: PlatformAccessPage,
});
