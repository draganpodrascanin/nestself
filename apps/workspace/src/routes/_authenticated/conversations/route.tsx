import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../../auth';

/**
 * The employee's own professional conversations. Convenience gate only
 * (`conversation.participate`); the API checks ownership of every row.
 */
export const Route = createFileRoute('/_authenticated/conversations')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'conversation.participate', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'conversations' } });
    }
  },
  component: Outlet,
});
