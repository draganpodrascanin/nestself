import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../../../auth';
import { isSampleDataMode } from '../../../../data-source';
import { HandlerCaseScreen } from '../../../../features/feedback/handler-case-screen';
import { listeningApi } from '../../../../features/listening/listening-api';

/** One assigned case for its handler (spec FBK-02, FBK-04); an unassigned id answers 404. */
export const Route = createFileRoute('/_authenticated/feedback/inbox/$caseId')({
  beforeLoad: async ({ context }) => {
    if (isSampleDataMode) return;
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'feedback_case.handle', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'feedback_inbox' } });
    }
  },
  component: HandlerCasePage,
});

function HandlerCasePage() {
  const { caseId } = Route.useParams();
  return <HandlerCaseScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} caseId={caseId} />;
}
