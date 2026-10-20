import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { canManageTeam } from '@nestself/contracts';

export const Route = createFileRoute('/_authenticated/_manager')({
  beforeLoad: ({ context }) => {
    if (!canManageTeam(context.session)) {
      throw redirect({ to: '/', search: { denied: 'manager' } });
    }
  },
  component: ManagerLayout,
});

function ManagerLayout() {
  return <Outlet />;
}
