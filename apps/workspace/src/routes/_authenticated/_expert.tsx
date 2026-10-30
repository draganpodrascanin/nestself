import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../auth';

/**
 * The expert area. Convenience gate only: the user has an expert record or
 * holds `conversation.read.assigned` in the current context. Every
 * `/professional/*` read is authorized on the server, row by row. The
 * screens below move the session into the expert context once.
 */
export const Route = createFileRoute('/_authenticated/_expert')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    const allowed =
      principal !== null &&
      (principal.expert !== null || can(principal, 'conversation.read.assigned', undefined, effectiveActions));
    if (!allowed) {
      throw redirect({ to: '/', search: { denied: 'expert' } });
    }
  },
  component: ExpertLayout,
});

function ExpertLayout() {
  return <Outlet />;
}
