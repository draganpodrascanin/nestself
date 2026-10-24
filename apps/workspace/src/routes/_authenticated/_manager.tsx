import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../auth';

export const Route = createFileRoute('/_authenticated/_manager')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'events.request', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'manager' } });
    }
  },
  component: ManagerLayout,
});

function ManagerLayout() {
  return <Outlet />;
}
