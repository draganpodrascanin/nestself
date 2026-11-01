import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../auth';
import { isSampleDataMode } from '../../data-source';

/** The actions that open the employer listening area; the API authorizes every call again. */
export const LISTENING_AREA_ACTIONS = [
  'listening.reports.read',
  'listening.cycles.manage',
  'workplace_reviews.request',
  'workplace_reviews.engagement.read',
  'workplace_reviews.scope.accept',
  'workplace_reviews.actions.manage',
] as const;

export function canOpenListeningArea(principal: Parameters<typeof can>[0] | null, effectiveActions: readonly string[]): boolean {
  return !!principal && LISTENING_AREA_ACTIONS.some((action) => can(principal, action, undefined, effectiveActions));
}

/**
 * Gate of the organization's listening area (overview, heatmap, dimensions,
 * surveys, reviews, settings): any one listening or review action lets a user
 * in; each screen then shows only what their own actions allow.
 */
export const Route = createFileRoute('/_authenticated/_listening')({
  beforeLoad: async ({ context }) => {
    if (isSampleDataMode) return;
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!canOpenListeningArea(principal, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'listening' } });
    }
  },
  component: ListeningLayout,
});

function ListeningLayout() {
  return <Outlet />;
}
