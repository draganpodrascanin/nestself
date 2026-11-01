import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../data-source';
import { listeningApi } from '../../../../features/listening/listening-api';
import { ListeningGate } from '../../../../features/listening/listening-gate';
import { EngagementsScreen } from '../../../../features/reviews/engagements-screen';

/** The reviewer's engagements (spec REV-07); `/expert/workplace-reviews/*` enforces the assignment on the server. */
export const Route = createFileRoute('/_authenticated/reviews/engagements/')({
  component: () => (
    <ListeningGate action="workplace_reviews.report.write">
      <EngagementsScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />
    </ListeningGate>
  ),
});
