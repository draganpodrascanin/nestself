import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Heading, StatusBlock, Table, Td, Text, Th } from '@nestself/ui';
import type { Appointment } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { STATUS_TONE, outcomeColumn, useCategoryLabel, useZonedFormat } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';
import { canListConsultations, isConsultingExpert, requireConsultationList } from '../../../calls/route-gate';
import { sampleFirstName } from '../../../calls/sample';
import { useConsultationList } from '../../../calls/use-consultations';

export const Route = createFileRoute('/_authenticated/consultations/')({
  beforeLoad: ({ context }) => requireConsultationList(context.auth),
  component: ConsultationsPage,
});

function ConsultationRow({ appointment, linked, now }: { appointment: Appointment; linked: boolean; now: number }) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const categoryLabel = useCategoryLabel();
  const employee = (isSampleDataMode ? sampleFirstName(appointment.employeeUserId) : null) ?? t('consultations.employeeFallback');
  const when = format.short(appointment.startsAt, appointment.timeZone);
  const outcome = outcomeColumn(appointment, now);
  return (
    <tr>
      <Td>
        {linked ? (
          <Link to="/consultations/$appointmentId" params={{ appointmentId: appointment.id }} className="text-primary underline underline-offset-[0.2em]">
            {employee}
          </Link>
        ) : (
          employee
        )}
      </Td>
      <Td>{categoryLabel(appointment.serviceCategory)}</Td>
      <Td>
        <time dateTime={appointment.startsAt}>{when}</time>
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[appointment.status]}>{t(`appointments.status.${appointment.status}`)}</Badge>
      </Td>
      <Td>
        {outcome === 'toRecord' ? <Badge tone="warning">{t('consultations.outcomeColumn.toRecord')}</Badge> : t(`consultations.outcomeColumn.${outcome}`)}
      </Td>
    </tr>
  );
}

function ConsultationsPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const list = useConsultationList();
  const [now] = useState(() => Date.now());

  if (!canListConsultations(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }
  const expert = isConsultingExpert(principal, effectiveActions);

  return (
    <div className="space-y-6">
      <div className="gap-2 flex flex-col">
        <Heading level={1}>{t('calls:consultations.title')}</Heading>
        <Text className="text-text-secondary">{t('calls:consultations.intro')}</Text>
        {expert ? null : <Text className="text-text-secondary">{t('calls:consultations.operationsNote')}</Text>}
      </div>

      {list.status === 'pending' ? <StatusBlock state="loading" title={t('common:state.loading')} body="" /> : null}
      {list.status === 'error' ? (
        <StatusBlock
          state="offline"
          title={t('calls:consultations.errorTitle')}
          body={mapCallError(list.error, tCalls)}
          action={{ label: t('common:action.retry'), onClick: list.refetch }}
        />
      ) : null}
      {list.status === 'success' && list.items.length === 0 ? (
        <StatusBlock state="empty" title={t('calls:consultations.emptyTitle')} body={t('calls:consultations.emptyBody')} />
      ) : null}

      {list.items.length > 0 ? (
        <Table caption={t('calls:consultations.title')}>
          <thead>
            <tr>
              <Th>{t('calls:consultations.columns.employee')}</Th>
              <Th>{t('calls:consultations.columns.service')}</Th>
              <Th>{t('calls:consultations.columns.time')}</Th>
              <Th>{t('calls:consultations.columns.status')}</Th>
              <Th>{t('calls:consultations.columns.outcome')}</Th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((appointment) => (
              <ConsultationRow key={appointment.id} appointment={appointment} linked={expert && appointment.expertUserId === principal?.userId} now={now} />
            ))}
          </tbody>
        </Table>
      ) : null}

      {list.hasNextPage ? (
        <Button variant="secondary" onClick={list.fetchNextPage} loading={list.isFetchingNextPage} loadingLabel={t('calls:appointments.loadingMore')}>
          {t('calls:appointments.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
