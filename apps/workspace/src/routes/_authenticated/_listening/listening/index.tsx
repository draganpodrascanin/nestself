import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../data-source';
import { listeningApi } from '../../../../features/listening/listening-api';
import { OverviewScreen } from '../../../../features/listening/overview-screen';

export const Route = createFileRoute('/_authenticated/_listening/listening/')({
  component: () => <OverviewScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});
