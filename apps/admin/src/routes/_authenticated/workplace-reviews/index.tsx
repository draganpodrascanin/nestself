import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../data-source';
import { listeningApi } from '../../../features/listening/listening-api';
import { ListeningGate } from '../../../features/listening/listening-gate';
import { QueueScreen } from '../../../features/reviews/queue-screen';

/** The coordinator's queue of review requests (spec REV-03, OPS-02); `/ops/workplace-reviews/*` enforces `workplace_reviews.coordinate`. */
export const Route = createFileRoute('/_authenticated/workplace-reviews/')({
  component: () => (
    <ListeningGate action="workplace_reviews.coordinate">
      <QueueScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />
    </ListeningGate>
  ),
});
