import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../data-source';
import { listeningApi } from '../../../features/listening/listening-api';
import { ListeningGate } from '../../../features/listening/listening-gate';
import { RequestDetailScreen } from '../../../features/reviews/request-detail-screen';

/** One review request with triage, scopes and the engagement (spec REV-03, REV-05, REV-06). */
export const Route = createFileRoute('/_authenticated/workplace-reviews/$requestId')({
  component: RequestPage,
});

function RequestPage() {
  const { requestId } = Route.useParams();
  return (
    <ListeningGate action="workplace_reviews.coordinate">
      <RequestDetailScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} requestId={requestId} />
    </ListeningGate>
  );
}
