import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';

export const Route = createFileRoute('/_authenticated/_manager')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (!principal || !can(principal, 'events.request', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'manager' } });
    }
  },
  component: ManagerLayout,
});

function ManagerLayout() {
  return <Outlet />;
}
