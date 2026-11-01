import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { can } from '@nestself/contracts';
import { Heading } from '@nestself/ui';
import { useAuth } from '../../../auth';
import { opsAdminApi } from '../../../features/access/use-ops-admin';
import { OrgHeading } from '../../../features/organizations/org-heading';
import { isSampleDataMode } from '../../../data-source';

const TAB_CLASS = 'px-3 py-2 -mb-px border-b-2 no-underline type-label';
const INACTIVE_TAB = { className: 'border-transparent text-text-secondary' };
const ACTIVE_TAB = { className: 'border-primary text-primary', 'aria-current': 'page' as const };

/**
 * Organization detail: heading (from `getOrganization`, or the sample) and
 * section links; the sections are child routes. A tab is shown by the action
 * its routes need; the server enforces it again.
 */
function OrgDetailLayout() {
  const { orgId } = Route.useParams();
  const { t } = useTranslation('admin');
  const { principal, effectiveActions } = useAuth();
  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const showPeople = allowed('client.configure');
  const showAccess = allowed('access.preview');
  const showListening = allowed('listening.configure');

  return (
    <div>
      <Heading level={1}>{t('organizations.detail')}</Heading>
      <OrgHeading opsApi={opsAdminApi} orgId={orgId} sampleMode={isSampleDataMode} />

      <nav aria-label={t('organizations.tabsLabel')} className="mt-6 flex gap-2 border-b border-border-subtle">
        <Link
          to="/organizations/$orgId"
          params={{ orgId }}
          activeOptions={{ exact: true }}
          className={TAB_CLASS}
          inactiveProps={INACTIVE_TAB}
          activeProps={ACTIVE_TAB}
        >
          {t('organizations.tabs.overview')}
        </Link>
        {showPeople ? (
          <Link
            to="/organizations/$orgId/people"
            params={{ orgId }}
            className={TAB_CLASS}
            inactiveProps={INACTIVE_TAB}
            activeProps={ACTIVE_TAB}
          >
            {t('organizations.tabs.people')}
          </Link>
        ) : null}
        {showAccess ? (
          <Link
            to="/organizations/$orgId/access"
            params={{ orgId }}
            className={TAB_CLASS}
            inactiveProps={INACTIVE_TAB}
            activeProps={ACTIVE_TAB}
          >
            {t('organizations.tabs.access')}
          </Link>
        ) : null}
        {showListening ? (
          <Link
            to="/organizations/$orgId/listening"
            params={{ orgId }}
            className={TAB_CLASS}
            inactiveProps={INACTIVE_TAB}
            activeProps={ACTIVE_TAB}
          >
            {t('listening:nav.listening')}
          </Link>
        ) : null}
      </nav>

      <div className="mt-8">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/organizations/$orgId')({
  component: OrgDetailLayout,
});
