import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Heading,
  Text,
  MetricCard,
  Table,
  Th,
  Td,
  ProtectedValue,
  EventRequestSummary,
} from '@nestself/ui';
import { SAMPLE_HR_PROGRAMME, SAMPLE_EVENT_REQUEST } from '@nestself/sample-data';
import { formatCurrency } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

export const Route = createFileRoute('/_authenticated/_hr/hr/')({
  component: HrIndexPage,
});

function HrIndexPage() {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const currency = SAMPLE_HR_PROGRAMME.currency;

  const programmeRows = [
    {
      measure: t('workspace:hr.eligible'),
      value: String(SAMPLE_HR_PROGRAMME.eligibleEmployees),
    },
    {
      measure: t('workspace:hr.activated'),
      value: String(SAMPLE_HR_PROGRAMME.activatedAccounts),
    },
    {
      measure: t('workspace:hr.fund'),
      value: formatCurrency(SAMPLE_HR_PROGRAMME.availableFund, currency, locale),
    },
    {
      measure: t('workspace:hr.reserved'),
      value: formatCurrency(SAMPLE_HR_PROGRAMME.reserved, currency, locale),
    },
  ];

  return (
    <div className="space-y-8">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:hr.programme')}
      </Heading>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label={t('workspace:hr.eligible')}
          value={String(SAMPLE_HR_PROGRAMME.eligibleEmployees)}
        />
        <MetricCard
          label={t('workspace:hr.fund')}
          value={formatCurrency(SAMPLE_HR_PROGRAMME.availableFund, currency, locale)}
        />
        <MetricCard
          label={t('workspace:hr.reserved')}
          value={formatCurrency(SAMPLE_HR_PROGRAMME.reserved, currency, locale)}
        />
      </div>

      {/* Programme measures table */}
      <Table density="default">
        <thead>
          <tr>
            <Th className="bg-tint border-b border-border-subtle">{t('workspace:hr.programme')}</Th>
            <Th numeric className="bg-tint border-b border-border-subtle">{t('common:action.viewTotal')}</Th>
          </tr>
        </thead>
        <tbody>
          {programmeRows.map((row) => (
            <tr key={row.measure}>
              <Td className="border-b border-border-subtle">{row.measure}</Td>
              <Td numeric className="border-b border-border-subtle">{row.value}</Td>
            </tr>
          ))}
          <tr>
            <Td className="border-b border-border-subtle">{t('workspace:hr.teamBreakdown')}</Td>
            <Td numeric className="border-b border-border-subtle">
              <ProtectedValue
                label={t('common:state.protected.title')}
                reason={t('common:state.protected.body')}
              />
            </Td>
          </tr>
        </tbody>
      </Table>

      <Text className="text-text-secondary type-metadata">
        {t('workspace:hr.protectedNote')}
      </Text>

      {/* Event request summary */}
      <Heading level={2} typeRole="sectionTitle" className="mt-8">
        {t('common:nav.manage')}
      </Heading>
      <EventRequestSummary
        request={{
          participants: String(SAMPLE_EVENT_REQUEST.participants),
          location: SAMPLE_EVENT_REQUEST.location,
          dates: '',
          budget: '',
          options: [...SAMPLE_EVENT_REQUEST.options],
          workflow: [],
        }}
        labels={{
          field: t('workspace:hr.programme'),
          example: t('common:sample.demoNoop'),
          required: t('workspace:hr.programme'),
          participants: t('common:count.participant_other', { count: SAMPLE_EVENT_REQUEST.participants }),
          location: SAMPLE_EVENT_REQUEST.location,
          dates: '',
          budget: '',
          yes: t('common:action.confirm'),
          no: t('common:action.cancel'),
        }}
      />
    </div>
  );
}
