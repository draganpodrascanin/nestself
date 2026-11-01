import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../../data-source';
import { listeningApi } from '../../../../../features/listening/listening-api';
import { RequestScreen } from '../../../../../features/reviews/request-screen';

/** One review request with its scopes (spec REV-02, REV-05). */
export const Route = createFileRoute('/_authenticated/_listening/listening/reviews/$requestId')({
  component: RequestPage,
});

function RequestPage() {
  const { requestId } = Route.useParams();
  return <RequestScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} requestId={requestId} />;
}
