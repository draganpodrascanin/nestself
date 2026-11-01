import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Heading, Skeleton, StatusBlock, Text, buttonClassNames } from '@nestself/ui';
import { LISTENING_DIMENSION_KEYS } from '@nestself/contracts';
import type { DimensionCell, ListeningHeatmapResponse } from '@nestself/contracts';
import { useAuth } from '../../auth';
import { useOrgContext } from '../people/use-org-context';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { sampleHeatmap } from './sample-listening';
import { scoreTone, statusKey } from './score-tone';
import { useHeatmap } from './use-listening';

export interface HeatmapScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  snapshotId?: string;
}

/**
 * The department heatmap (spec REP-02): rows are the company and the disjoint
 * departments, columns the five dimensions, cells carry value, text status
 * and colour, hidden cells a neutral placeholder; the table scrolls on
 * narrow screens with a sticky row header and every cell is focusable with
 * an accessible name.
 */
export function HeatmapScreen({ listeningApi, sampleMode, snapshotId }: HeatmapScreenProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { principal } = useAuth();
  const { orgId, needsChoice, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useHeatmap(listeningApi, apiOrgId, snapshotId ?? null);

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:heatmap.title')}</Heading>
      <Text tone="secondary">{t('listening:heatmap.lead', { minimum: 10 })}</Text>
      <Link to="/listening" className="type-label text-primary underline">
        {t('listening:heatmap.back')}
      </Link>
    </div>
  );

  if (!principal || orgId === null) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">{t(needsChoice ? 'workspace:people.chooseOrganization' : 'workspace:people.noOrganization', { ns: 'workspace' })}</Alert>
      </div>
    );
  }
  if (!sampleMode && (switchError || query.isError)) {
    const key = listeningErrorMessageKey(switchError ?? query.error);
    if (key === 'listening:errors.notFound') {
      return (
        <div className="space-y-6">
          {header}
          <StatusBlock state="empty" title={t('listening:heatmap.empty')} body={t('listening:overview.noResultsBody')} />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{t(key ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!sampleMode && query.isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={6} label={t('common:state.loading')} />
      </div>
    );
  }
  const heatmap: ListeningHeatmapResponse | undefined = sampleMode ? sampleHeatmap() : query.data;
  if (!heatmap) return <div className="space-y-6">{header}</div>;

  const cohortName = (row: ListeningHeatmapResponse['rows'][number]) =>
    row.kind === 'company' ? t('listening:heatmap.company') : row.kind === 'unassigned' ? t('listening:heatmap.unassigned') : row.name;

  const cellValue = (cell: DimensionCell) => (cell.score !== null ? `${cell.score}%` : t('listening:heatmap.hidden'));
  const cellLabel = (cell: DimensionCell, cohort: string) =>
    t('listening:heatmap.cellLabel', {
      dimension: t(`listening:dimensions.${cell.key}.title`),
      cohort,
      value: cell.score !== null ? t('listening:status.scoreLabel', { score: cell.score, status: t(statusKey(cell)) }) : t(statusKey(cell)),
    });

  return (
    <div className="space-y-6">
      {header}
      {heatmap.stale ? <Alert tone="warning">{t('listening:overview.stale', { days: 45 })}</Alert> : null}
      <div className="overflow-x-auto rounded-card border border-border-subtle">
        <table className="w-full min-w-[40rem] border-collapse type-table">
          <caption className="sr-only">{t('listening:heatmap.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-surface px-3 py-2 text-left type-label border-b border-border-subtle">
                {t('listening:heatmap.cohort')}
              </th>
              {LISTENING_DIMENSION_KEYS.map((key) => (
                <th key={key} scope="col" className="bg-tint px-3 py-2 text-left type-label border-b border-border-subtle">
                  {t(`listening:dimensions.${key}.short`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.rows.map((row) => {
              const name = cohortName(row);
              return (
                <tr key={row.cohortKey}>
                  <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left type-label border-b border-border-subtle">
                    {name}
                  </th>
                  {LISTENING_DIMENSION_KEYS.map((key) => {
                    const cell = row.cells.find((c) => c.key === key) ?? {
                      key,
                      scoreTenths: null,
                      score: null,
                      status: null,
                      grayReason: 'not_measured' as const,
                      respondentCount: null,
                      distribution: null,
                    };
                    return (
                      <td key={key} className="border-b border-border-subtle px-2 py-2 align-top">
                        <Link
                          to="/listening/dimensions/$key"
                          params={{ key }}
                          search={snapshotId ? { snapshotId } : {}}
                          aria-label={cellLabel(cell, name)}
                          className="flex flex-col gap-1 rounded-control p-1 no-underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          <span className="type-label text-text" aria-hidden>
                            {cellValue(cell)}
                          </span>
                          <Badge tone={scoreTone(cell)}>{t(statusKey(cell))}</Badge>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="heatmap-legend" className="space-y-1">
        <Heading level={2} typeRole="sectionTitle" id="heatmap-legend">
          {t('listening:heatmap.legend')}
        </Heading>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:heatmap.legendBody')}
        </Text>
      </section>
      <Link to="/listening" className={buttonClassNames({ variant: 'secondary', size: 'sm' })}>
        {t('listening:heatmap.back')}
      </Link>
    </div>
  );
}
