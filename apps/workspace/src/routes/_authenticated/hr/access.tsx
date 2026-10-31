import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { AccessScreen } from '../../../features/access/access-screen';
import { orgAdminApi } from '../../../features/access/use-org-admin';
import { isSampleDataMode } from '../../../data-source';
import { resolveRouteAuth } from '../../../auth';

/**
 * Not under the `_hr` gate (`program.overview`): an employer owner holds
 * `access.preview` without any HR template, and the member and org-unit lists
 * the page reads accept it. This gate is a convenience that mirrors the
 * effective actions of `/auth/me`; the API authorizes every call again.
 */
export const Route = createFileRoute('/_authenticated/hr/access')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'access.preview', undefined, effectiveActions)) {
      throw redirect({ to: '/', search: { denied: 'hr' } });
    }
  },
  component: AccessPage,
});

function AccessPage() {
  return <AccessScreen adminApi={orgAdminApi} sampleMode={isSampleDataMode} />;
}
