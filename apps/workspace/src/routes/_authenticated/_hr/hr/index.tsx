import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Heading,
  Text,
  MetricCard,
  MetricGroup,
  Table,
  Th,
  Td,
  ProtectedValue,
  EventRequestSummary,
  eventRequestRows,
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
      meaning: t('workspace:hr.meaningEligible'),
    },
    {
      measure: t('workspace:hr.activated'),
      value: String(SAMPLE_HR_PROGRAMME.activatedAccounts),
      meaning: t('workspace:hr.meaningActivated'),
    },
    {
      measure: t('workspace:hr.fund'),
      value: formatCurrency(SAMPLE_HR_PROGRAMME.availableFund, currency, locale),
      meaning: t('workspace:hr.meaningFund'),
    },
    {
      measure: t('workspace:hr.reserved'),
      value: formatCurrency(SAMPLE_HR_PROGRAMME.reserved, currency, locale),
      meaning: '',
    },
  ];

  return (
    <div className="space-y-8">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:hr.programme')}
      </Heading>

      {/* Metric cards */}
      <MetricGroup label={t('workspace:hr.programme')} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </MetricGroup>

      {/* Programme measures table */}
      <Table density="default">
        <thead>
          <tr>
            <Th className="bg-tint border-b border-border-subtle">{t('workspace:hr.measure')}</Th>
            <Th numeric className="bg-tint border-b border-border-subtle">{t('workspace:hr.value')}</Th>
            <Th className="bg-tint border-b border-border-subtle">{t('workspace:hr.meaning')}</Th>
          </tr>
        </thead>
        <tbody>
          {programmeRows.map((row) => (
            <tr key={row.measure}>
              <Td className="border-b border-border-subtle">{row.measure}</Td>
              <Td numeric className="border-b border-border-subtle">{row.value}</Td>
              <Td className="border-b border-border-subtle text-text-secondary type-metadata">{row.meaning}</Td>
            </tr>
          ))}
          <tr>
            <Td className="border-b border-border-subtle">{t('workspace:hr.teamBreakdown')}</Td>
            <Td numeric className="border-b border-border-subtle">
              <ProtectedValue
                label={t('workspace:hr.protectedLabel')}
                reason={t('workspace:hr.meaningTeamBreakdown')}
                totalAction={
                  <button
                    type="button"
                    className="type-metadata text-primary underline"
                    aria-label={t('workspace:hr.viewTotal')}
                    onClick={() => {
                      /* No-op in sample mode */
                    }}
                  >
                    {t('workspace:hr.viewTotal')}
                  </button>
                }
              />
            </Td>
            <Td className="border-b border-border-subtle text-text-secondary type-metadata">
              {t('workspace:hr.meaningTeamBreakdown')}
            </Td>
          </tr>
        </tbody>
      </Table>

      <Text className="text-text-secondary type-metadata">
        {t('workspace:hr.protectedNote')}
      </Text>

      {/* Team experiences / event request summary */}
      <section className="space-y-4">
        <Heading level={2} typeRole="sectionTitle">
          {t('workspace:hr.teamExperiences')}
        </Heading>
        <Text className="text-text-secondary">
          {t('workspace:hr.teamExperiencesLead')}
        </Text>
        <EventRequestSummary
          rows={eventRequestRows(SAMPLE_EVENT_REQUEST, {
            participantsLocation: t('common:events.participantsLocation'),
            datesBudget: t('common:events.datesBudget'),
            options: t('common:events.options'),
            workflow: t('common:events.workflow'),
            exampleDatesBudget: t('common:events.exampleDatesBudget'),
            exampleWorkflow: t('common:events.exampleWorkflow'),
            compareParticipantsLocation: t('common:events.compareParticipantsLocation'),
            compareDatesBudget: t('common:events.compareDatesBudget'),
            compareOptions: t('common:events.compareOptions'),
            compareWorkflow: t('common:events.compareWorkflow'),
          })}
          labels={{
            field: t('common:events.field'),
            example: t('common:events.example'),
            comparison: t('common:events.comparison'),
          }}
        />
      </section>
    </div>
  );
}
