import { createFileRoute } from '@tanstack/react-router';
import { ClientConfigurationScreen } from '../../../../features/listening/client-configuration-screen';
import { listeningApi } from '../../../../features/listening/listening-api';
import { ListeningGate } from '../../../../features/listening/listening-gate';
import { isSampleDataMode } from '../../../../data-source';

function OrgListeningPage() {
  const { orgId } = Route.useParams();
  return (
    <ListeningGate action="listening.configure">
      <ClientConfigurationScreen listeningApi={listeningApi} orgId={orgId} sampleMode={isSampleDataMode} />
    </ListeningGate>
  );
}

export const Route = createFileRoute('/_authenticated/organizations/$orgId/listening')({
  component: OrgListeningPage,
});
