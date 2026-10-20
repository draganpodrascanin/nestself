import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, EventRequestSummary, eventRequestRows } from '@nestself/ui';
import { SAMPLE_EVENT_REQUEST } from '@nestself/sample-data';

function EventRequestsPage() {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <div>
      <Heading level={1}>{t('admin:eventRequests.title')}</Heading>
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
        className="mt-6"
      />
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/event-requests')({
  component: EventRequestsPage,
});
