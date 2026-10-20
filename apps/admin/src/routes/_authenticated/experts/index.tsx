import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Text, Table, Th, Td, Avatar, Badge } from '@nestself/ui';
import type { TableDensity } from '@nestself/ui';
import { SAMPLE_EXPERTS } from '@nestself/sample-data';

/** Expert display data enriched from the sparse fixture. */
const DISPLAY_EXPERTS = SAMPLE_EXPERTS.map((expert, i) => ({
  ...expert,
  displayName: (['Milica Ristić', 'Dragan Vasić', 'Tamara Kovačević'] as const)[i] ?? expert.initials,
  languages: (['sr', 'sr, en', 'sr, en'] as const)[i] ?? 'sr',
  format: (['online', 'in-person', 'online'] as const)[i] ?? 'online',
}));

function ExpertsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const [density, setDensity] = useState<TableDensity>('default');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Heading level={1}>{t('admin:experts.title')}</Heading>
        {/* Density switch: unavailable on coarse pointers (touch devices) */}
        <div className="hidden pointer-fine:flex items-center gap-2" role="radiogroup" aria-label={t('admin:experts.density')}>
          <button
            type="button"
            role="radio"
            aria-checked={density === 'default'}
            onClick={() => setDensity('default')}
            className={`rounded-control px-3 py-1.5 type-metadata border border-border-control ${density === 'default' ? 'bg-primary text-on-primary' : 'bg-surface text-text-secondary'}`}
          >
            {t('admin:experts.densityDefault')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={density === 'compact'}
            onClick={() => setDensity('compact')}
            className={`rounded-control px-3 py-1.5 type-metadata border border-border-control ${density === 'compact' ? 'bg-primary text-on-primary' : 'bg-surface text-text-secondary'}`}
          >
            {t('admin:experts.densityCompact')}
          </button>
        </div>
      </div>
      <Text className="mt-2 text-text-secondary">{t('admin:experts.realPortraitNote')}</Text>
      <div className="mt-6">
        <Table caption={t('admin:experts.title')} density={density}>
          <thead>
            <tr>
              <Th>{t('admin:experts.name')}</Th>
              <Th>{t('admin:experts.area')}</Th>
              <Th>{t('admin:experts.languages')}</Th>
              <Th>{t('admin:experts.format')}</Th>
            </tr>
          </thead>
          <tbody>
            {DISPLAY_EXPERTS.map((expert) => (
              <tr key={expert.id}>
                <Td>
                  <Link
                    to="/experts/$expertId"
                    params={{ expertId: expert.id }}
                    className="flex items-center gap-3 no-underline text-primary"
                  >
                    <Avatar initials={expert.initials} name={expert.displayName} size="sm" />
                    <span>{expert.displayName}</span>
                  </Link>
                </Td>
                <Td>
                  <Badge tone="neutral">{t(`common:area.${expert.area}`)}</Badge>
                </Td>
                <Td>{expert.languages}</Td>
                <Td>{expert.format}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/experts/')({
  component: ExpertsPage,
});
