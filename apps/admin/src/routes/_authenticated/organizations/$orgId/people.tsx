import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBlock } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth } from '../../../../auth';
import { opsAdminApi } from '../../../../features/access/use-ops-admin';
import { OpsPeopleScreen } from '../../../../features/people/people-screen';
import { isSampleDataMode } from '../../../../data-source';

/** Shown to principals holding `client.configure`; the `/ops/orgs/*` routes enforce it again. */
function OrgPeoplePage() {
  const { orgId } = Route.useParams();
  const { t } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  if (!principal || !can(principal, 'client.configure', undefined, effectiveActions)) {
    return <StatusBlock state="permission" title={t('state.permission.title')} body={t('state.permission.body')} />;
  }
  return <OpsPeopleScreen opsApi={opsAdminApi} orgId={orgId} sampleMode={isSampleDataMode} />;
}

export const Route = createFileRoute('/_authenticated/organizations/$orgId/people')({
  component: OrgPeoplePage,
});
