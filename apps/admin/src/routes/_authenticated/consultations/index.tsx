/**
 * `/consultations`: the expert's consultations, upcoming first, then past
 * (CALL-18); for operations, every consultation of the organisations they
 * coordinate, with organisation, status and date filters and a read-only
 * view (CALL-28). The API scopes the rows by the caller's context.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Field, Heading, Input, Select, StatusBlock, Table, Td, Text, Th, buttonClassNames } from '@nestself/ui';
import type { AppointmentView } from '@nestself/api-client';
import { APPOINTMENT_STATUSES, AppointmentStatusSchema } from '@nestself/contracts';
import { SAMPLE_ORG } from '@nestself/sample-data';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { STATUS_TONE, outcomeColumn, roomClosesAt, useCategoryLabel, useZonedFormat } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';
import { canListConsultations, isConsultingExpert, requireConsultationList } from '../../../calls/route-gate';
import { sampleFirstName } from '../../../calls/sample';
import { useConsultationList } from '../../../calls/use-consultations';
import { useCanBook, useOpsOrganizations } from '../../../calls/use-ops-organizations';
import type { ConsultationListParams, ConsultationListState } from '../../../calls/use-consultations';

export const Route = createFileRoute('/_authenticated/consultations/')({
  beforeLoad: ({ context }) => requireConsultationList(context.auth),
  component: ConsultationsPage,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** The organisation's name: from the row (`orgName`), the organisation list, or the sample organisation; its id otherwise. */
function organisationLabel(orgId: string, names: ReadonlyMap<string, string>): string {
  return names.get(orgId) ?? (isSampleDataMode && orgId === SAMPLE_ORG.id ? SAMPLE_ORG.name : orgId);
}

function firstName(appointment: AppointmentView, who: 'employee' | 'expert'): string | null {
  if (isSampleDataMode) return sampleFirstName(who === 'employee' ? appointment.employeeUserId : appointment.expertUserId);
  return appointment[who]?.firstName ?? null;
}

/** Start of a local calendar day as an ISO instant; `null` for an empty or malformed input. */
function dayStart(day: string, offsetDays = 0): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offsetDays);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

interface RowProps {
  appointment: AppointmentView;
  now: number;
  /** Operations: expert and organisation columns, and a read-only view. */
  operations: boolean;
  orgNames: ReadonlyMap<string, string>;
}

function ConsultationRow({ appointment, now, operations, orgNames }: RowProps) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const categoryLabel = useCategoryLabel();
  const employee = firstName(appointment, 'employee') ?? t('consultations.employeeFallback');
  const outcome = outcomeColumn(appointment, now);
  const link = (
    <Link to="/consultations/$appointmentId" params={{ appointmentId: appointment.id }} className="text-primary underline underline-offset-[0.2em]">
      {operations ? t('consultations.view') : employee}
    </Link>
  );
  return (
    <tr>
      <Td>{operations ? employee : link}</Td>
      {operations ? <Td>{firstName(appointment, 'expert') ?? t('appointments.yourExpert')}</Td> : null}
      {operations ? <Td>{appointment.orgName ?? organisationLabel(appointment.orgId, orgNames)}</Td> : null}
      <Td>{categoryLabel(appointment.serviceCategory)}</Td>
      <Td>
        <time dateTime={appointment.startsAt}>{format.short(appointment.startsAt, appointment.timeZone)}</time>
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[appointment.status]}>{t(`appointments.status.${appointment.status}`)}</Badge>
      </Td>
      <Td>
        {outcome === 'toRecord' ? <Badge tone="warning">{t('consultations.outcomeColumn.toRecord')}</Badge> : t(`consultations.outcomeColumn.${outcome}`)}
      </Td>
      {operations ? <Td>{link}</Td> : null}
    </tr>
  );
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

function ConsultationTable({
  caption,
  items,
  now,
  operations,
  orgNames = NO_NAMES,
}: {
  caption: string;
  items: readonly AppointmentView[];
  now: number;
  operations: boolean;
  orgNames?: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation('calls');
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>{t('consultations.columns.employee')}</Th>
          {operations ? <Th>{t('consultations.columns.expert')}</Th> : null}
          {operations ? <Th>{t('consultations.columns.organisation')}</Th> : null}
          <Th>{t('consultations.columns.service')}</Th>
          <Th>{t('consultations.columns.time')}</Th>
          <Th>{t('consultations.columns.status')}</Th>
          <Th>{t('consultations.columns.outcome')}</Th>
          {operations ? <Th>{t('consultations.view')}</Th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((appointment) => (
          <ConsultationRow key={appointment.id} appointment={appointment} now={now} operations={operations} orgNames={orgNames} />
        ))}
      </tbody>
    </Table>
  );
}

function LoadState({ list, emptyWhenDone = true }: { list: ConsultationListState; emptyWhenDone?: boolean }) {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  if (list.status === 'pending') return <StatusBlock state="loading" title={t('common:state.loading')} body="" />;
  if (list.status === 'error') {
    return (
      <StatusBlock
        state="offline"
        title={t('calls:consultations.errorTitle')}
        body={mapCallError(list.error, tCalls)}
        action={{ label: t('common:action.retry'), onClick: list.refetch }}
      />
    );
  }
  if (emptyWhenDone && list.items.length === 0) {
    return <StatusBlock state="empty" title={t('calls:consultations.emptyTitle')} body={t('calls:consultations.emptyBody')} />;
  }
  return null;
}

function LoadMore({ list }: { list: ConsultationListState }) {
  const { t } = useTranslation('calls');
  if (!list.hasNextPage) return null;
  return (
    <Button variant="secondary" onClick={list.fetchNextPage} loading={list.isFetchingNextPage} loadingLabel={t('appointments.loadingMore')}>
      {t('appointments.loadMore')}
    </Button>
  );
}

/** The expert's view: what is ahead, then what is behind (CALL-18). */
function ExpertConsultations({ now }: { now: number }) {
  const { t } = useTranslation('calls');
  const [since] = useState(() => new Date(now - DAY_MS).toISOString());
  const recent = useConsultationList({ from: since, order: 'asc' });
  // History newest first from the API, so the first page is the latest sessions.
  const history = useConsultationList({ to: since, order: 'desc' });
  // Upcoming until the room closes; anything finished or no longer active is past.
  const isUpcoming = (item: AppointmentView) =>
    (item.status === 'confirmed' || item.status === 'proposed' || item.status === 'awaiting_approval') && roomClosesAt(item).getTime() > now;
  const upcoming = recent.items.filter(isUpcoming);
  const past = [...new Map([...recent.items.filter((item) => !isUpcoming(item)), ...history.items].map((item) => [item.id, item])).values()].sort(
    (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt),
  );
  const settled = recent.status === 'success' && history.status === 'success';

  return (
    <>
      <LoadState list={recent} emptyWhenDone={false} />
      <LoadState list={history} emptyWhenDone={false} />
      {settled && upcoming.length === 0 && past.length === 0 ? (
        <StatusBlock state="empty" title={t('consultations.emptyTitle')} body={t('consultations.emptyBody')} />
      ) : null}
      {upcoming.length > 0 ? (
        <section aria-labelledby="consultations-upcoming" className="space-y-3">
          <Heading level={2} typeRole="sectionTitle" id="consultations-upcoming">
            {t('consultations.upcoming')}
          </Heading>
          <ConsultationTable caption={t('consultations.upcoming')} items={upcoming} now={now} operations={false} />
          <LoadMore list={recent} />
        </section>
      ) : null}
      {past.length > 0 ? (
        <section aria-labelledby="consultations-past" className="space-y-3">
          <Heading level={2} typeRole="sectionTitle" id="consultations-past">
            {t('consultations.past')}
          </Heading>
          <ConsultationTable caption={t('consultations.past')} items={past} now={now} operations={false} />
          <LoadMore list={history} />
        </section>
      ) : null}
    </>
  );
}

interface FilterValues {
  orgId: string;
  status: string;
  from: string;
  to: string;
}

const NO_FILTERS: FilterValues = { orgId: '', status: '', from: '', to: '' };

function toParams(values: FilterValues): ConsultationListParams {
  const status = AppointmentStatusSchema.safeParse(values.status);
  return {
    // Operations look back first: newest first unless they narrow the dates.
    order: 'desc',
    orgId: values.orgId.trim() || undefined,
    status: status.success ? status.data : undefined,
    from: dayStart(values.from),
    // `to` is exclusive: the end of the chosen day.
    to: dayStart(values.to, 1),
  };
}

/** Operations: filter by organisation, status and dates (CALL-28). */
function OperationsConsultations({ now }: { now: number }) {
  const { t } = useTranslation('calls');
  const [draft, setDraft] = useState<FilterValues>(NO_FILTERS);
  const [applied, setApplied] = useState<FilterValues>(NO_FILTERS);
  const list = useConsultationList(toParams(applied));
  // Names from GET /ops/orgs and the rows' orgName; ids only when neither has one.
  const organizations = useOpsOrganizations();
  const orgNames = new Map<string, string>([
    ...organizations.items.map((org): [string, string] => [org.id, org.name]),
    ...list.items.flatMap((item): [string, string][] => (item.orgName ? [[item.orgId, item.orgName]] : [])),
  ]);
  const orgOptions = [
    ...new Set([
      ...organizations.items.map((org) => org.id),
      ...(isSampleDataMode ? [SAMPLE_ORG.id] : []),
      ...(applied.orgId ? [applied.orgId] : []),
      ...list.items.map((item) => item.orgId),
    ]),
  ];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApplied(draft);
  };
  const clear = () => {
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
  };

  return (
    <>
      <form onSubmit={submit} aria-labelledby="consultation-filters" className="gap-4 p-4 flex flex-col rounded-card border border-border-subtle bg-surface">
        <h2 id="consultation-filters" className="type-label text-text">
          {t('consultations.filters.title')}
        </h2>
        <div className="gap-4 grid sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('consultations.filters.organisation')}>
            <Select
              options={[
                { value: '', label: t('consultations.filters.allOrganisations') },
                ...orgOptions.map((orgId) => ({ value: orgId, label: organisationLabel(orgId, orgNames) })),
              ]}
              value={draft.orgId}
              onValueChange={(value) => setDraft({ ...draft, orgId: value ?? '' })}
            />
          </Field>
          <Field label={t('consultations.filters.status')}>
            <Select
              options={[
                { value: '', label: t('consultations.filters.allStatuses') },
                ...APPOINTMENT_STATUSES.map((status) => ({ value: status, label: t(`appointments.status.${status}`) })),
              ]}
              value={draft.status}
              onValueChange={(value) => setDraft({ ...draft, status: value ?? '' })}
            />
          </Field>
          <Field label={t('consultations.filters.from')}>
            <Input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
          </Field>
          <Field label={t('consultations.filters.to')}>
            <Input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
          </Field>
        </div>
        <div className="gap-3 flex flex-wrap">
          <Button type="submit">{t('consultations.filters.apply')}</Button>
          <Button type="button" variant="secondary" onClick={clear}>
            {t('consultations.filters.clear')}
          </Button>
        </div>
      </form>
      <LoadState list={list} />
      {list.items.length > 0 ? <ConsultationTable caption={t('consultations.title')} items={list.items} now={now} operations orgNames={orgNames} /> : null}
      <LoadMore list={list} />
    </>
  );
}

function ConsultationsPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { principal, effectiveActions } = useAuth();
  const [now] = useState(() => Date.now());
  const canCreate = useCanBook();

  if (!canListConsultations(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }
  const expert = isConsultingExpert(principal, effectiveActions);

  return (
    <div className="space-y-6">
      <div className="gap-2 flex flex-col">
        <div className="gap-3 flex flex-wrap items-center justify-between">
          <Heading level={1}>{t('calls:consultations.title')}</Heading>
          {canCreate ? (
            <Link to="/consultations/new" className={buttonClassNames({ variant: 'primary', size: 'md' })}>
              {t('calls:consultations.newConsultation')}
            </Link>
          ) : null}
        </div>
        <Text className="text-text-secondary">{t('calls:consultations.intro')}</Text>
        {expert ? null : <Text className="text-text-secondary">{t('calls:consultations.operationsNote')}</Text>}
      </div>
      {expert ? <ExpertConsultations now={now} /> : <OperationsConsultations now={now} />}
    </div>
  );
}
