/**
 * `/approvals`: the approver's follow-up approval items (T-CW-1.10, D-CW-37).
 * Shown to a session whose `effectiveActions` include `approval.decide`; the
 * server authorizes every call (the approver or the alternate of each item,
 * the self-approval rule), so this gate is a convenience only.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../../auth';
import { callsApi } from '../../../calls/calls-api';
import { isSampleDataMode } from '../../../data-source';
import { ApprovalsScreen } from './-approvals-screen';

const APPROVAL_ACTION = 'approval.decide' as const;

export const Route = createFileRoute('/_authenticated/approvals/')({
  beforeLoad: async ({ context, location }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal) {
      if (isSampleDataMode) return;
      throw redirect({ to: '/sign-in', search: { return: location.pathname } });
    }
    if (!can(principal, APPROVAL_ACTION, undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'approvals' } });
    }
  },
  component: ApprovalsPage,
});

function ApprovalsPage() {
  return <ApprovalsScreen api={callsApi} sampleMode={isSampleDataMode} />;
}
