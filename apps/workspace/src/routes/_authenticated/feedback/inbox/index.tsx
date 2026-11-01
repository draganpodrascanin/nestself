import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../../../auth';
import { isSampleDataMode } from '../../../../data-source';
import { InboxScreen } from '../../../../features/feedback/inbox-screen';
import { listeningApi } from '../../../../features/listening/listening-api';

/** The handler's inbox (spec FBK-04): for holders of `feedback_case.handle`; the API lists only assigned cases. */
export const Route = createFileRoute('/_authenticated/feedback/inbox/')({
  beforeLoad: async ({ context }) => {
    if (isSampleDataMode) return;
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'feedback_case.handle', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'feedback_inbox' } });
    }
  },
  component: () => <InboxScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});
