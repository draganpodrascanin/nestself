import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../data-source';
import { MyCaseScreen } from '../../../features/feedback/my-case-screen';
import { listeningApi } from '../../../features/listening/listening-api';

/** One of the reporter's own cases (spec FBK-02); anyone else's id answers 404. */
export const Route = createFileRoute('/_authenticated/feedback/$caseId')({
  component: MyCasePage,
});

function MyCasePage() {
  const { caseId } = Route.useParams();
  return <MyCaseScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} caseId={caseId} />;
}
