/**
 * `/consultations/new` (CALL-26): operations book a consultation for an
 * employee of an organisation they coordinate, with an expert approved for
 * the service. Times are picked in the organisation's zone (Europe/Belgrade,
 * D-CW-38) and sent as UTC instants. The API decides (`bookings.coordinate`
 * on the organisation) and its refusals render on the fields: an expert not
 * approved for the category (400 on `expertUserId`) and an employee who is
 * not a member (409 `subject_not_member`). Sample mode books nothing.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, FormErrorSummary, Heading, Input, Select, StatusBlock, Text } from '@nestself/ui';
import type { FormError, FormErrorSummaryHandle } from '@nestself/ui';
import { ApiError, appointmentKeys, retryUnlessClientError } from '@nestself/api-client';
import { SupportAreaSchema, can } from '@nestself/contracts';
import { SAMPLE_ORG, SAMPLE_PEOPLE } from '@nestself/sample-data';
import { zonedDateTimeToIso } from '@nestself/video';
import { resolveRouteAuth, useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { callsApi } from '../../../calls/calls-api';
import { useZonedFormat } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';
import { Reveal } from '../../../calls/reveal';
import { opsAdminApi, useOrgMembers } from '../../../features/access/use-ops-admin';
import { useOpsOrganizations } from '../../../calls/use-ops-organizations';

const BOOKING_ACTION = 'bookings.coordinate';
/** The organisation default zone (D-CW-38). */
const TIME_ZONE = 'Europe/Belgrade';

export const Route = createFileRoute('/_authenticated/consultations/new')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal) {
      if (isSampleDataMode) return;
      throw redirect({ to: '/sign-in' });
    }
    if (!can(principal, BOOKING_ACTION, undefined, effectiveActions)) throw redirect({ to: '/consultations' });
  },
  component: NewConsultationPage,
});

type FieldName = 'orgId' | 'employeeUserId' | 'expertUserId' | 'serviceCategory' | 'date' | 'start' | 'end';

const FIELD_ID: Record<FieldName, string> = {
  orgId: 'create-org',
  employeeUserId: 'create-employee',
  expertUserId: 'create-expert',
  serviceCategory: 'create-category',
  date: 'create-date',
  start: 'create-start',
  end: 'create-end',
};

const SAMPLE_EMPLOYEES = SAMPLE_PEOPLE.filter((person) => person.orgId === SAMPLE_ORG.id);
const SAMPLE_EXPERTS = SAMPLE_PEOPLE.filter((person) => person.platformRole === 'expert');

function NewConsultationPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const format = useZonedFormat();
  const queryClient = useQueryClient();
  const summaryRef = useRef<FormErrorSummaryHandle>(null);
  const [values, setValues] = useState<Record<FieldName, string>>({
    orgId: isSampleDataMode ? SAMPLE_ORG.id : '',
    employeeUserId: '',
    expertUserId: '',
    serviceCategory: 'psychological',
    date: '',
    start: '',
    end: '',
  });
  const [memberOrg, setMemberOrg] = useState<string | null>(null);
  const organizations = useOpsOrganizations();
  // A picked organisation loads its members at once; a typed id (the ids-only fallback) on leaving the field.
  const orgPicker = !isSampleDataMode && organizations.status === 'success' && organizations.items.length > 0;
  const members = useOrgMembers(opsAdminApi, isSampleDataMode ? null : orgPicker ? values.orgId || null : memberOrg);
  const experts = useQuery({
    queryKey: ['ops-appointment-experts', values.serviceCategory],
    queryFn: () => callsApi.listAppointmentExperts({ serviceCategory: values.serviceCategory }),
    enabled: !isSampleDataMode && values.serviceCategory !== '',
    retry: retryUnlessClientError,
  });
  const expertPicker = isSampleDataMode || (experts.isSuccess && experts.data.items.length > 0);
  const expertOptions = isSampleDataMode
    ? SAMPLE_EXPERTS.map((person) => ({ value: person.id, label: person.displayName }))
    : (experts.data?.items ?? []).map((expert) => ({ value: expert.userId, label: expert.displayName }));
  const [errors, setErrors] = useState<FormError[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'info'; message: string } | null>(null);

  if (!principal || !can(principal, BOOKING_ACTION, undefined, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  const set = (field: FieldName) => (value: string | null) => setValues((current) => ({ ...current, [field]: value ?? '' }));
  const errorOf = (field: FieldName) => errors.find((error) => error.id === FIELD_ID[field])?.message;
  const labels: Record<FieldName, string> = {
    orgId: tCalls('create.organisation'),
    employeeUserId: tCalls('create.employee'),
    expertUserId: tCalls('create.expert'),
    serviceCategory: tCalls('create.category'),
    date: tCalls('create.date'),
    start: tCalls('create.start'),
    end: tCalls('create.end'),
  };
  const fail = (next: FormError[]) => {
    setErrors(next);
    queueMicrotask(() => summaryRef.current?.focus());
  };
  const fieldError = (field: FieldName, message: string): FormError => ({ id: FIELD_ID[field], label: labels[field], message });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    const next: FormError[] = (Object.keys(FIELD_ID) as FieldName[])
      .filter((field) => values[field].trim() === '')
      .map((field) => fieldError(field, tCalls('create.errors.required')));
    const startsAt = zonedDateTimeToIso(values.date, values.start, TIME_ZONE);
    const endsAt = zonedDateTimeToIso(values.date, values.end, TIME_ZONE);
    if (next.length === 0 && startsAt && endsAt) {
      if (Date.parse(startsAt) <= Date.now()) next.push(fieldError('start', tCalls('followUp.errors.past')));
      else if (Date.parse(endsAt) <= Date.parse(startsAt)) next.push(fieldError('end', tCalls('followUp.errors.endBeforeStart')));
    }
    if (next.length > 0 || !startsAt || !endsAt) {
      fail(next.length > 0 ? next : [fieldError('date', tCalls('followUp.errors.dateTimeRequired'))]);
      return;
    }
    setErrors([]);
    if (isSampleDataMode) {
      setResult({ tone: 'info', message: tCalls('sample.actionNoop') });
      return;
    }
    const orgId = values.orgId.trim();
    setPending(true);
    try {
      const created = await callsApi.createAppointment(orgId, {
        orgId,
        employeeUserId: values.employeeUserId.trim(),
        expertUserId: values.expertUserId.trim(),
        serviceCategory: values.serviceCategory,
        startsAt,
        endsAt,
        timeZone: TIME_ZONE,
      });
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
      setResult({
        tone: 'success',
        message: tCalls('create.created', { date: format.date(created.startsAt, created.timeZone), time: format.time(created.startsAt, created.timeZone) }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'subject_not_member') fail([fieldError('employeeUserId', tCalls('create.errors.notMember'))]);
      else if (err instanceof ApiError && err.code === 'validation' && err.details?.['field'] === 'expertUserId') {
        fail([fieldError('expertUserId', tCalls('create.errors.expertCategory'))]);
      } else fail([fieldError('orgId', mapCallError(err, tCalls))]);
    } finally {
      setPending(false);
    }
  };

  const memberOptions = isSampleDataMode
    ? SAMPLE_EMPLOYEES.map((person) => ({ value: person.id, label: person.displayName }))
    : (members.data ?? []).map((member) => ({ value: member.userId, label: member.displayName }));
  const employeeAsSelect = isSampleDataMode || (members.isSuccess && memberOptions.length > 0);

  return (
    <div className="space-y-6">
      <Link to="/consultations" className="text-primary underline underline-offset-[0.2em]">
        {tCalls('consultations.back')}
      </Link>
      <div className="gap-2 flex flex-col">
        <Heading level={1}>{tCalls('create.title')}</Heading>
        <Text className="text-text-secondary">{tCalls('create.intro')}</Text>
      </div>
      <form noValidate onSubmit={(event) => void submit(event)} className="gap-5 max-w-2xl flex flex-col">
        <Reveal show={errors.length > 0}>
          <FormErrorSummary ref={summaryRef} title={tCalls('create.errorSummary')} errors={errors} />
        </Reveal>
        <Field id={FIELD_ID.orgId} label={isSampleDataMode || orgPicker ? labels.orgId : tCalls('create.organisationId')} error={errorOf('orgId')} required>
          {isSampleDataMode ? (
            <Select options={[{ value: SAMPLE_ORG.id, label: SAMPLE_ORG.name }]} value={values.orgId} onValueChange={set('orgId')} />
          ) : orgPicker ? (
            <Select
              options={organizations.items.map((org) => ({ value: org.id, label: org.name }))}
              placeholder={tCalls('create.chooseOrganisation')}
              value={values.orgId}
              onValueChange={(value) => {
                set('orgId')(value);
                set('employeeUserId')('');
              }}
            />
          ) : (
            // Ids only (the organisation list failed): the member list loads once focus leaves the field.
            <div className="contents" onBlur={() => setMemberOrg(values.orgId.trim() || null)}>
              <Input value={values.orgId} onChange={(event) => set('orgId')(event.target.value)} autoComplete="off" />
            </div>
          )}
        </Field>
        <Reveal show={organizations.status === 'error'}>
          <Alert tone="warning">{`${tCalls('create.organisationsFailed')} ${mapCallError(organizations.error, tCalls)}`}</Alert>
        </Reveal>
        <Field id={FIELD_ID.employeeUserId} label={employeeAsSelect ? labels.employeeUserId : tCalls('create.employeeId')} error={errorOf('employeeUserId')} required>
          {employeeAsSelect ? (
            <Select
              options={memberOptions}
              placeholder={tCalls('create.chooseEmployee')}
              value={values.employeeUserId}
              onValueChange={set('employeeUserId')}
            />
          ) : (
            <Input value={values.employeeUserId} onChange={(event) => set('employeeUserId')(event.target.value)} autoComplete="off" />
          )}
        </Field>
        <Reveal show={members.isError}>
          <Alert tone="warning">{`${tCalls('create.membersFailed')} ${mapCallError(members.error, tCalls)}`}</Alert>
        </Reveal>
        <Field id={FIELD_ID.expertUserId} label={expertPicker ? labels.expertUserId : tCalls('create.expertId')} error={errorOf('expertUserId')} required>
          {expertPicker ? (
            <Select options={expertOptions} placeholder={tCalls('create.chooseExpert')} value={values.expertUserId} onValueChange={set('expertUserId')} />
          ) : (
            <Input value={values.expertUserId} onChange={(event) => set('expertUserId')(event.target.value)} autoComplete="off" />
          )}
        </Field>
        <Reveal show={experts.isError}>
          <Alert tone="warning">{`${tCalls('create.expertsFailed')} ${mapCallError(experts.error, tCalls)}`}</Alert>
        </Reveal>
        <Field id={FIELD_ID.serviceCategory} label={labels.serviceCategory} error={errorOf('serviceCategory')} required>
          <Select
            options={SupportAreaSchema.options.map((area) => ({ value: area, label: t(`common:area.${area}`) }))}
            value={values.serviceCategory}
            onValueChange={set('serviceCategory')}
          />
        </Field>
        <div className="gap-4 grid sm:grid-cols-3">
          <Field id={FIELD_ID.date} label={labels.date} error={errorOf('date')} required>
            <Input type="date" value={values.date} onChange={(event) => set('date')(event.target.value)} />
          </Field>
          <Field id={FIELD_ID.start} label={labels.start} error={errorOf('start')} required>
            <Input type="time" value={values.start} onChange={(event) => set('start')(event.target.value)} />
          </Field>
          <Field id={FIELD_ID.end} label={labels.end} error={errorOf('end')} required>
            <Input type="time" value={values.end} onChange={(event) => set('end')(event.target.value)} />
          </Field>
        </div>
        <p className="type-metadata text-text-secondary">{tCalls('create.timeZone', { timeZone: TIME_ZONE })}</p>
        <div>
          <Button type="submit" loading={pending} loadingLabel={tCalls('create.submit')}>
            {tCalls('create.submit')}
          </Button>
        </div>
        <Reveal show={result !== null}>
          <Alert tone={result?.tone ?? 'info'}>{result?.message}</Alert>
        </Reveal>
      </form>
    </div>
  );
}
