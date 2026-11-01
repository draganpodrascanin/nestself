import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../auth';
import { isSampleDataMode } from '../../data-source';
import { listeningApi } from '../../features/listening/listening-api';
import { SurveyScreen } from '../../features/listening/survey-screen';
import { useAuth } from '../../auth';

/**
 * The employee survey (spec EMP-01, EMP-02). Holders of
 * `listening.respond.self` (every employee) in their personal context; the
 * API resolves the organization and the caller's own participation.
 */
export const Route = createFileRoute('/_authenticated/survey')({
  beforeLoad: async ({ context }) => {
    if (isSampleDataMode) return;
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'listening.respond.self', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'survey' } });
    }
  },
  component: SurveyPage,
});

function SurveyPage() {
  const { principal } = useAuth();
  const ctx = principal?.context;
  const orgId = ctx && 'orgId' in ctx ? (ctx.orgId ?? null) : null;
  const organizationName = principal?.memberships.find((m) => m.orgId === orgId)?.orgName ?? principal?.memberships[0]?.orgName ?? null;
  return <SurveyScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} organizationName={organizationName} />;
}
