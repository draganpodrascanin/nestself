import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';

export const Route = createFileRoute('/_authenticated/_hr')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (!principal || !can(principal, 'program.overview', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'hr' } });
    }
  },
  component: HrLayout,
});

function HrLayout() {
  return <Outlet />;
}
