import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../data-source';
import { listeningApi } from '../../../../features/listening/listening-api';
import { ListeningSettingsScreen } from '../../../../features/listening/settings-screen';

export const Route = createFileRoute('/_authenticated/_listening/listening/settings')({
  component: () => <ListeningSettingsScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});
