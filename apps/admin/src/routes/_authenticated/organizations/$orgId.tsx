import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { can } from '@nestself/contracts';
import { Heading } from '@nestself/ui';
import { SAMPLE_ORG } from '@nestself/sample-data';
import { useAuth } from '../../../auth';

const TAB_CLASS = 'px-3 py-2 -mb-px border-b-2 no-underline type-label';
const INACTIVE_TAB = { className: 'border-transparent text-text-secondary' };
const ACTIVE_TAB = { className: 'border-primary text-primary', 'aria-current': 'page' as const };

/** Organization detail: heading and section links; the sections are child routes. */
function OrgDetailLayout() {
  const { orgId } = Route.useParams();
  const { t } = useTranslation('admin');
  const { principal, effectiveActions } = useAuth();
  const showAccess = principal ? can(principal, 'access.preview', undefined, effectiveActions) : false;

  return (
    <div>
      <Heading level={1}>{t('organizations.detail')}</Heading>
      <Heading level={2} className="mt-6">{SAMPLE_ORG.name}</Heading>

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
