import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../auth';

export const Route = createFileRoute('/_authenticated/_hr')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'program.overview', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'hr' } });
    }
  },
  component: HrLayout,
});

function HrLayout() {
  return <Outlet />;
}
