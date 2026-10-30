import { createFileRoute } from '@tanstack/react-router';
import { opsAdminApi } from '../../../features/access/use-ops-admin';
import { SsoScreen } from '../../../features/sso/sso-screen';
import { isSampleDataMode } from '../../../data-source';

function SsoPage() {
  return <SsoScreen opsApi={opsAdminApi} sampleMode={isSampleDataMode} />;
}

export const Route = createFileRoute('/_authenticated/sso/')({
  component: SsoPage,
});
