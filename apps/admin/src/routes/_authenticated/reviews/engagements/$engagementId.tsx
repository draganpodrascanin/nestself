import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../data-source';
import { listeningApi } from '../../../../features/listening/listening-api';
import { ListeningGate } from '../../../../features/listening/listening-gate';
import { EngagementWorkspaceScreen } from '../../../../features/reviews/engagement-workspace-screen';

/** The reviewer's workspace: pack, report, notes, actions, follow-up and completion (spec REV-04, REV-07..09). */
export const Route = createFileRoute('/_authenticated/reviews/engagements/$engagementId')({
  component: EngagementPage,
});

function EngagementPage() {
  const { engagementId } = Route.useParams();
  return (
    <ListeningGate action="workplace_reviews.report.write">
      <EngagementWorkspaceScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} engagementId={engagementId} />
    </ListeningGate>
  );
}
