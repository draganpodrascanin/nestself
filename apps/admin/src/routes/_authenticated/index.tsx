import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, MetricCard, MetricGroup, Badge } from '@nestself/ui';
import { SAMPLE_EXPERTS } from '@nestself/sample-data';

function OverviewPage() {
  const { t } = useTranslation('admin');

  const metrics = [
    {
      label: t('dashboard.activeExperts'),
      value: String(SAMPLE_EXPERTS.length),
    },
    {
      label: t('dashboard.totalOrganizations'),
      value: '1',
    },
    {
      label: t('dashboard.openEventRequests'),
      value: '1',
    },
  ];

  return (
    <div>
      <Heading level={1}>{t('dashboard.overview')}</Heading>
      <MetricGroup label={t('dashboard.overview')} className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-card border border-border-subtle bg-surface p-6"
          >
            <MetricCard label={metric.label} value={metric.value} />
            <Badge tone="warning" className="mt-3">
              {t('dashboard.sampleLabel')}
            </Badge>
          </div>
        ))}
      </MetricGroup>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/')({
  component: OverviewPage,
});
