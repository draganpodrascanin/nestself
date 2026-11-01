import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../../data-source';
import { listeningApi } from '../../../../../features/listening/listening-api';
import { EngagementScreen } from '../../../../../features/reviews/engagement-screen';

/** One engagement: meeting, sharing, report, actions and follow-up (spec REV-04..10). */
export const Route = createFileRoute('/_authenticated/_listening/listening/reviews/engagements/$engagementId')({
  component: EngagementPage,
});

function EngagementPage() {
  const { engagementId } = Route.useParams();
  return <EngagementScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} engagementId={engagementId} />;
}
