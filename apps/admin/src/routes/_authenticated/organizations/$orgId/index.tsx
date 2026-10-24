import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Table, Th, Td, MetricCard } from '@nestself/ui';
import { SAMPLE_TEAMS, SAMPLE_PEOPLE, SAMPLE_HR_PROGRAMME } from '@nestself/sample-data';
import { formatCurrency, isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import i18n from '../../../../i18n';

function OrgOverviewPage() {
  const { orgId } = Route.useParams();
  const { t } = useTranslation('admin');

  const teams = SAMPLE_TEAMS.filter((team) => team.orgId === orgId);
  const members = SAMPLE_PEOPLE.filter((p) => p.orgId === orgId);

  const resolved = i18n.resolvedLanguage ?? 'en';
  const locale: Locale = isLocale(resolved) ? resolved : 'en';

  return (
    <div>
      <Heading level={3}>{t('organizations.teams')}</Heading>
      <div className="mt-4">
        <Table caption={t('organizations.teams')}>
          <thead>
            <tr>
              <Th>{t('organizations.name')}</Th>
              <Th numeric>{t('organizations.members')}</Th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const count = members.filter(
                // Team assignment is not in sample data, so show org-level count per team
                () => true,
              ).length;
              return (
                <tr key={team.id}>
                  <Td>{team.name}</Td>
                  <Td numeric>{count}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <Heading level={3} className="mt-8">{t('organizations.programme')}</Heading>
      <dl className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-card border border-border-subtle bg-surface p-6">
          <MetricCard
            label={t('organizations.employees')}
            value={String(SAMPLE_HR_PROGRAMME.eligibleEmployees)}
          />
        </div>
        <div className="rounded-card border border-border-subtle bg-surface p-6">
          <MetricCard
            label={t('dashboard.totalUsers')}
            value={String(SAMPLE_HR_PROGRAMME.activatedAccounts)}
          />
        </div>
        <div className="rounded-card border border-border-subtle bg-surface p-6">
          <MetricCard
            label={formatCurrency(SAMPLE_HR_PROGRAMME.availableFund, SAMPLE_HR_PROGRAMME.currency, locale)}
            value={formatCurrency(SAMPLE_HR_PROGRAMME.reserved, SAMPLE_HR_PROGRAMME.currency, locale)}
            hint={t('organizations.programme')}
          />
        </div>
      </dl>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/organizations/$orgId/')({
  component: OrgOverviewPage,
});
