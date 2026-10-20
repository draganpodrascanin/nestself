import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { canAccessHr } from '@nestself/contracts';

export const Route = createFileRoute('/_authenticated/_hr')({
  beforeLoad: ({ context }) => {
    if (!canAccessHr(context.session)) {
      throw redirect({ to: '/', search: { denied: 'hr' } });
    }
  },
  component: HrLayout,
});

function HrLayout() {
  return <Outlet />;
}
