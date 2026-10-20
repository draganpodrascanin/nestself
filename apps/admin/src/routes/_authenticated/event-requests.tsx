import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, EventRequestSummary } from '@nestself/ui';
import { SAMPLE_EVENT_REQUEST } from '@nestself/sample-data';

function EventRequestsPage() {
  const { t } = useTranslation('admin');

  const request = {
    participants: String(SAMPLE_EVENT_REQUEST.participants),
    location: SAMPLE_EVENT_REQUEST.location,
    dates: '2026-11-15',
    budget: 'TBD',
    options: [...SAMPLE_EVENT_REQUEST.options],
    workflow: ['requested'],
  };

  const labels = {
    title: t('eventRequests.title'),
    field: t('eventRequests.field'),
    example: t('eventRequests.example'),
    required: t('eventRequests.required'),
    participants: t('eventRequests.participants'),
    location: t('eventRequests.location'),
    dates: t('eventRequests.dates'),
    budget: t('eventRequests.budget'),
    yes: t('eventRequests.yes'),
    no: t('eventRequests.no'),
  };

  return (
    <div>
      <Heading level={1}>{t('eventRequests.title')}</Heading>
      <EventRequestSummary request={request} labels={labels} className="mt-6" />
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/event-requests')({
  component: EventRequestsPage,
});
