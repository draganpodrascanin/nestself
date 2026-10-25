/**
 * The occurrence form (WBN-30, D-CW-34, D-CW-36), for a new draft and in
 * edit mode (`PATCH /ops/webinars/:id`, prefilled; the audience only while a
 * draft): title and description per locale, audience (every eligible
 * organisation, chosen organisations, or units of one organisation),
 * capacity from 1 to 1,000 (media replication, T-CW-3.2), presenters and the moderator, and the
 * schedule in Europe/Belgrade, shown with the time zone. There is no
 * recording switch: every webinar is recorded, and the form says so.
 *
 * The capacity is checked here (1 to 1,000, `max` on the input) and on the
 * server, whose 400 `capacity_above_limit` the form shows at the field and in
 * the summary too, naming the limit and the milestone. Every other failure
 * renders translated copy (error-visibility rule).
 *
 * Presenters, the moderator and organisations are picked from the API's
 * candidate lists (`GET /ops/webinars/host-candidates`, `GET /ops/orgs`), or
 * from the sample principals and `SAMPLE_ORG` in sample mode; when a list
 * cannot be loaded, the form takes ids instead and says so.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Checkbox,
  CheckboxGroup,
  Field,
  Fieldset,
  FormErrorSummary,
  Input,
  RadioGroup,
  RadioItem,
  Select,
  Textarea,
} from '@nestself/ui';
import type { FormError, FormErrorSummaryHandle } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import type { WebinarCreateBody } from '@nestself/api-client';
import {
  WEBINAR_DESCRIPTION_MAX_LENGTH,
  WEBINAR_REPLICATED_CAPACITY,
  WEBINAR_SINGLE_MEETING_CAPACITY,
  WEBINAR_TITLE_MAX_LENGTH,
} from '@nestself/contracts';
import type { Webinar, WebinarAudiencePolicy, WebinarAudiencePolicyType, WebinarLocalizedText, WebinarUpdateRequest } from '@nestself/contracts';
import { zonedDateTimeToIso } from '@nestself/video';
import { isSampleDataMode } from '../data-source';
import { Reveal } from '../calls/reveal';
import { mapWebinarError } from './map-webinar-error';
import { useHostOptions, useOrganizationOptions } from './picker-options';
import type { PickerOption } from './sample';
import { webinarsApi } from './webinars-api';

/** Every webinar runs on Belgrade time for now (D-CW-09); the form shows it. */
export const WEBINAR_FORM_TIME_ZONE = 'Europe/Belgrade';

const LOCALES = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const;
type FormLocale = (typeof LOCALES)[number];

const FIELD = {
  title: 'webinar-title-en',
  description: 'webinar-description',
  audience: 'webinar-audience',
  organizations: 'webinar-organizations',
  units: 'webinar-units',
  capacity: 'webinar-capacity',
  presenters: 'webinar-presenters',
  moderator: 'webinar-moderator',
  date: 'webinar-date',
  times: 'webinar-start',
} as const;
type FieldKey = keyof typeof FIELD;

/** The API's field names (`details.field`) in the form's terms. */
const API_FIELD: Readonly<Record<string, FieldKey>> = {
  title: 'title',
  description: 'description',
  audiencePolicy: 'organizations',
  capacity: 'capacity',
  presenterUserIds: 'presenters',
  moderatorUserId: 'moderator',
  startsAt: 'times',
  endsAt: 'times',
};

const splitIds = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

/** `YYYY-MM-DD` and `HH:mm` of an instant in a time zone, for the date and time inputs in edit mode. */
function zonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function localized(data: FormData, prefix: string): WebinarLocalizedText | undefined {
  const entries = LOCALES.map((locale) => [locale, String(data.get(`${prefix}-${locale}`) ?? '').trim()] as const).filter(([, value]) => value);
  return entries.length > 0 ? (Object.fromEntries(entries) as WebinarLocalizedText) : undefined;
}

export interface WebinarFormProps {
  /** Edit mode (`PATCH /ops/webinars/:id`): the occurrence to change. Without it the form creates a draft. */
  webinar?: Webinar;
  /** The saved occurrence, as the API answered it. */
  onSaved: (webinar: Webinar) => void;
}

export function WebinarForm({ webinar, onSaved }: WebinarFormProps) {
  const { t, i18n } = useTranslation('calls');
  const formatCount = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language).format(value);
  const summary = useRef<FormErrorSummaryHandle>(null);
  const policy = webinar?.audiencePolicy;
  const timeZone = webinar?.timeZone ?? WEBINAR_FORM_TIME_ZONE;
  // The audience (and with it the organisation) changes only while the occurrence is a draft; the server answers `not_editable` otherwise.
  const audienceLocked = !!webinar && webinar.status !== 'draft';
  const start = webinar ? zonedParts(webinar.startsAt, timeZone) : null;
  const end = webinar ? zonedParts(webinar.endsAt, timeZone) : null;
  const [audience, setAudience] = useState<WebinarAudiencePolicyType>(policy?.type ?? 'all_eligible');
  const [organizations, setOrganizations] = useState<string[]>(policy?.type === 'organization' ? [...policy.orgIds] : []);
  const [unitOrganization, setUnitOrganization] = useState(policy?.type === 'org_unit' ? policy.orgId : '');
  const [presenters, setPresenters] = useState<string[]>(webinar?.hosts.filter((host) => host.role === 'presenter').map((host) => host.userId) ?? []);
  const [moderator, setModerator] = useState(webinar?.hosts.find((host) => host.role === 'moderator')?.userId ?? '');
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const presenterChoices = useHostOptions('presenter');
  const moderatorChoices = useHostOptions('moderator');
  const organizationChoices = useOrganizationOptions();
  const labels: Record<FieldKey, string> = {
    title: t('webinar.form.titleLegend'),
    description: t('webinar.form.descriptionLegend'),
    audience: t('webinar.form.audience'),
    organizations: t('webinar.form.organizations'),
    units: t('webinar.form.units'),
    capacity: t('webinar.form.capacity'),
    presenters: t('webinar.form.presenters'),
    moderator: t('webinar.form.moderator'),
    date: t('webinar.form.date'),
    times: t('webinar.form.startTime'),
  };

  const show = (next: Partial<Record<FieldKey, string>>) => {
    setErrors(next);
    if (Object.keys(next).length > 0) requestAnimationFrame(() => summary.current?.focus());
  };

  /** The request body, or the field errors that keep it from being sent. */
  const build = (data: FormData): { body: WebinarCreateBody | null; problems: Partial<Record<FieldKey, string>> } => {
    const problems: Partial<Record<FieldKey, string>> = {};
    const title = localized(data, 'title');
    const description = localized(data, 'description');
    if (!title) problems.title = t('webinar.form.titleRequired');
    else if (Object.values(title).some((value) => value.length > WEBINAR_TITLE_MAX_LENGTH)) problems.title = t('webinar.form.titleTooLong', { max: WEBINAR_TITLE_MAX_LENGTH });
    if (description && Object.values(description).some((value) => value.length > WEBINAR_DESCRIPTION_MAX_LENGTH)) {
      problems.description = t('webinar.form.descriptionTooLong', { max: WEBINAR_DESCRIPTION_MAX_LENGTH });
    }

    let audiencePolicy: WebinarAudiencePolicy = { type: 'all_eligible' };
    if (audience === 'organization') {
      const orgIds = organizationChoices.options ? organizations : splitIds(String(data.get('organizations') ?? ''));
      if (orgIds.length === 0) problems.organizations = t('webinar.form.organizationsRequired');
      audiencePolicy = { type: 'organization', orgIds };
    } else if (audience === 'org_unit') {
      // Units of one organisation (D-CW-17); the units are entered as ids until a unit list is served for operations.
      const orgId = (organizationChoices.options ? unitOrganization : String(data.get('unitOrganization') ?? '')).trim();
      const orgUnitIds = splitIds(String(data.get('units') ?? ''));
      if (!orgId) problems.organizations = t('webinar.form.organizationRequired');
      if (orgUnitIds.length === 0) problems.units = t('webinar.form.unitsRequired');
      audiencePolicy = { type: 'org_unit', orgId, orgUnitIds };
    }

    const capacityText = String(data.get('capacity') ?? '').trim();
    const capacity = Number(capacityText);
    if (!/^\d+$/.test(capacityText) || capacity < 1) problems.capacity = t('webinar.form.capacityRange');
    // D-CW-36: up to 1,000 with media replication (T-CW-3.2); the server answers 400 `capacity_above_limit` as well.
    else if (capacity > WEBINAR_REPLICATED_CAPACITY) problems.capacity = t('webinar.capacityAboveLimit', { limit: formatCount(WEBINAR_REPLICATED_CAPACITY) });

    const presenterUserIds = presenterChoices.options ? presenters : splitIds(String(data.get('presenters') ?? ''));
    const moderatorUserId = (moderatorChoices.options ? moderator : String(data.get('moderator') ?? '').trim()) || null;
    if (moderatorUserId && presenterUserIds.includes(moderatorUserId)) problems.moderator = t('webinar.form.moderatorNotPresenter');

    const date = String(data.get('date') ?? '');
    const startTime = String(data.get('startTime') ?? '');
    const endTime = String(data.get('endTime') ?? '');
    if (!date) problems.date = t('webinar.form.dateRequired');
    const startsAt = date && startTime ? zonedDateTimeToIso(date, startTime, timeZone) : null;
    const endsAt = date && endTime ? zonedDateTimeToIso(date, endTime, timeZone) : null;
    if (date && (!startsAt || !endsAt)) problems.times = t('webinar.form.timeRequired');
    else if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) problems.times = t('webinar.form.endAfterStart');

    if (Object.keys(problems).length > 0 || !title || !startsAt || !endsAt) return { body: null, problems };
    return {
      body: {
        title,
        ...(description ? { description } : {}),
        presenterUserIds,
        moderatorUserId,
        startsAt,
        endsAt,
        timeZone,
        audiencePolicy,
        capacity,
      },
      problems,
    };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    setNotice(null);
    const { body, problems } = build(new FormData(event.currentTarget));
    show(problems);
    if (!body) return;
    if (isSampleDataMode) {
      setNotice(t('sample.actionNoop'));
      return;
    }
    setPending(true);
    try {
      if (webinar) {
        // Every field is sent; the audience only while a draft, and an emptied description clears it.
        const { audiencePolicy, description, ...rest } = body;
        const update: WebinarUpdateRequest = { ...rest, description: description ?? null, ...(audienceLocked ? {} : { audiencePolicy }) };
        onSaved(await webinarsApi.updateOps(webinar.id, update));
      } else {
        onSaved(await webinarsApi.createOps(body));
      }
    } catch (err) {
      // The server names its limit in `details.limit`; the copy shows it in the reader's number format.
      const limit = err instanceof ApiError && typeof err.details?.limit === 'number' ? err.details.limit : WEBINAR_REPLICATED_CAPACITY;
      const message =
        err instanceof ApiError && err.code === 'capacity_above_limit' ? t('webinar.capacityAboveLimit', { limit: formatCount(limit) }) : mapWebinarError(err, t);
      const field = err instanceof ApiError ? (err.code === 'capacity_above_limit' ? 'capacity' : API_FIELD[String(err.details?.field ?? '')]) : undefined;
      if (field) show({ [field]: message });
      else setFailure(message);
    } finally {
      setPending(false);
    }
  };

  const summaryErrors: FormError[] = (Object.keys(errors) as FieldKey[]).map((key) => ({ id: FIELD[key], label: labels[key], message: errors[key] ?? '' }));

  const toggle = (list: string[], value: string, checked: boolean) => (checked ? [...list, value] : list.filter((entry) => entry !== value));

  const options = (choices: readonly PickerOption[], selected: string[], onChange: (next: string[]) => void) =>
    choices.map((option) => (
      <Checkbox key={option.value} checked={selected.includes(option.value)} onCheckedChange={(checked) => onChange(toggle(selected, option.value, checked))}>
        {option.label}
      </Checkbox>
    ));

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="gap-6 max-w-2xl flex flex-col" aria-label={t(webinar ? 'webinar.form.editTitle' : 'webinar.form.title')}>
      <FormErrorSummary ref={summary} title={t('webinar.form.errorSummary')} errors={summaryErrors} />
      <Reveal show={failure !== null}>
        <Alert tone="danger">{failure}</Alert>
      </Reveal>
      <Reveal show={notice !== null}>
        <Alert tone="info">{notice}</Alert>
      </Reveal>

      <Fieldset legend={t('webinar.form.titleLegend')} description={t('webinar.form.titleHint')}>
        <div className="gap-3 flex flex-col">
          {LOCALES.map((locale: FormLocale) => (
            <Field key={locale} label={t(`webinar.form.languages.${locale}`)} error={locale === 'en' ? errors.title : undefined}>
              <Input id={`webinar-title-${locale}`} name={`title-${locale}`} autoComplete="off" defaultValue={webinar?.title[locale] ?? ''} />
            </Field>
          ))}
        </div>
      </Fieldset>

      <div id={FIELD.description} tabIndex={-1}>
        <Fieldset legend={t('webinar.form.descriptionLegend')} description={t('webinar.form.descriptionHint', { max: WEBINAR_DESCRIPTION_MAX_LENGTH })}>
          <div className="gap-3 flex flex-col">
            {LOCALES.map((locale) => (
              <Field key={locale} label={t(`webinar.form.languages.${locale}`)} error={locale === 'en' ? errors.description : undefined}>
                <Textarea name={`description-${locale}`} rows={3} defaultValue={webinar?.description?.[locale] ?? ''} />
              </Field>
            ))}
          </div>
        </Fieldset>
      </div>

      <div id={FIELD.audience} tabIndex={-1} className="gap-3 flex flex-col">
        <p className="type-label text-text">{t('webinar.form.audience')}</p>
        {audienceLocked ? <p className="type-metadata text-text-secondary">{t('webinar.form.audienceLocked')}</p> : null}
        <RadioGroup
          label={t('webinar.form.audience')}
          value={audience}
          disabled={audienceLocked}
          onValueChange={(value) => setAudience(value === 'organization' || value === 'org_unit' ? value : 'all_eligible')}
        >
          <RadioItem value="all_eligible">{t('webinar.admin.audienceAll')}</RadioItem>
          <RadioItem value="organization">{t('webinar.form.audienceOrganizations')}</RadioItem>
          <RadioItem value="org_unit">{t('webinar.form.audienceUnits')}</RadioItem>
        </RadioGroup>
        <Reveal show={audience === 'organization' && !audienceLocked}>
          {organizationChoices.options ? (
            <div id={FIELD.organizations} tabIndex={-1}>
              <CheckboxGroup legend={t('webinar.form.organizations')}>
                {organizationChoices.pending ? <p className="type-metadata text-text-secondary">{t('common:state.loading')}</p> : null}
                {options(organizationChoices.options, organizations, setOrganizations)}
              </CheckboxGroup>
              {errors.organizations ? <p className="type-metadata text-danger">{errors.organizations}</p> : null}
            </div>
          ) : (
            <Field label={t('webinar.form.organizations')} description={`${t('webinar.form.organizationsUnavailable')} ${t('webinar.form.idsHint')}`} error={errors.organizations}>
              <Input id={FIELD.organizations} name="organizations" autoComplete="off" defaultValue={policy?.type === 'organization' ? policy.orgIds.join(', ') : ''} />
            </Field>
          )}
        </Reveal>
        <Reveal show={audience === 'org_unit' && !audienceLocked}>
          <div className="gap-3 flex flex-col">
            {organizationChoices.options ? (
              <div id={FIELD.organizations} tabIndex={-1}>
                <Field label={t('webinar.form.organization')} error={errors.organizations}>
                  <Select
                    options={[{ value: '', label: t('webinar.form.organization') }, ...organizationChoices.options]}
                    value={unitOrganization}
                    onValueChange={(value) => setUnitOrganization(value ?? '')}
                  />
                </Field>
              </div>
            ) : (
              <Field label={t('webinar.form.organization')} description={`${t('webinar.form.organizationsUnavailable')} ${t('webinar.form.idsHint')}`} error={errors.organizations}>
                <Input id={FIELD.organizations} name="unitOrganization" autoComplete="off" defaultValue={policy?.type === 'org_unit' ? policy.orgId : ''} />
              </Field>
            )}
            <Field label={t('webinar.form.units')} description={`${t('webinar.form.unitsUnavailable')} ${t('webinar.form.idsHint')}`} error={errors.units}>
              <Input id={FIELD.units} name="units" autoComplete="off" defaultValue={policy?.type === 'org_unit' ? policy.orgUnitIds.join(', ') : ''} />
            </Field>
          </div>
        </Reveal>
      </div>

      <Field label={t('webinar.form.capacity')} description={t('webinar.form.capacityHint', { limit: formatCount(WEBINAR_REPLICATED_CAPACITY) })} error={errors.capacity}>
        <Input
          id={FIELD.capacity}
          name="capacity"
          type="number"
          // The contract's default: one meeting's capacity.
          defaultValue={String(webinar?.capacity ?? WEBINAR_SINGLE_MEETING_CAPACITY)}
          className="max-w-40"
          // `Input` passes these through to the native input; its props do not list them.
          {...({ min: '1', max: String(WEBINAR_REPLICATED_CAPACITY) } as Record<string, string>)}
        />
      </Field>

      {presenterChoices.options ? (
        <Fieldset legend={t('webinar.form.presenters')} description={t('webinar.form.presentersHint')}>
          <div id={FIELD.presenters} tabIndex={-1} className="gap-1 flex flex-col">
            <CheckboxGroup legend={t('webinar.form.presenters')}>
              {presenterChoices.pending ? <p className="type-metadata text-text-secondary">{t('common:state.loading')}</p> : null}
              {options(presenterChoices.options, presenters, setPresenters)}
            </CheckboxGroup>
            {errors.presenters ? <p className="type-metadata text-danger">{errors.presenters}</p> : null}
          </div>
        </Fieldset>
      ) : (
        <Field
          label={t('webinar.form.presenters')}
          description={`${t('webinar.form.presentersHint')} ${t('webinar.form.hostsUnavailable')} ${t('webinar.form.idsHint')}`}
          error={errors.presenters}
        >
          <Input id={FIELD.presenters} name="presenters" autoComplete="off" defaultValue={presenters.join(', ')} />
        </Field>
      )}

      {moderatorChoices.options ? (
        <div id={FIELD.moderator} tabIndex={-1}>
          <Field label={t('webinar.form.moderator')} description={t('webinar.form.moderatorHint')} error={errors.moderator}>
            <Select
              options={[{ value: '', label: t('webinar.form.noModerator') }, ...moderatorChoices.options]}
              value={moderator}
              onValueChange={(value) => setModerator(value ?? '')}
            />
          </Field>
        </div>
      ) : (
        <Field label={t('webinar.form.moderator')} description={`${t('webinar.form.moderatorHint')} ${t('webinar.form.hostsUnavailable')}`} error={errors.moderator}>
          <Input id={FIELD.moderator} name="moderator" autoComplete="off" defaultValue={moderator} />
        </Field>
      )}

      <Fieldset legend={t('webinar.form.schedule')} description={t('webinar.form.timeZoneHint', { zone: timeZone })}>
        <div className="gap-3 flex flex-wrap">
          <Field label={t('webinar.form.date')} error={errors.date} className="min-w-44">
            <Input id={FIELD.date} name="date" type="date" defaultValue={start?.date ?? ''} />
          </Field>
          <Field label={t('webinar.form.startTime')} error={errors.times} className="min-w-32">
            <Input id={FIELD.times} name="startTime" type="time" defaultValue={start?.time ?? ''} />
          </Field>
          <Field label={t('webinar.form.endTime')} className="min-w-32">
            <Input id="webinar-end" name="endTime" type="time" defaultValue={end?.time ?? ''} />
          </Field>
        </div>
      </Fieldset>

      <p className="gap-2 p-3 flex items-start rounded-control bg-info-surface text-info type-body">{t('webinar.recordingNotice')}</p>

      <div className="gap-3 flex flex-wrap items-center">
        <Button type="submit" loading={pending} loadingLabel={t(webinar ? 'webinar.form.saving' : 'webinar.form.submitting')}>
          {t(webinar ? 'webinar.form.save' : 'webinar.form.submit')}
        </Button>
        {webinar ? (
          <Link to="/webinars/$webinarId" params={{ webinarId: webinar.id }} className="type-body text-primary underline underline-offset-[0.2em]">
            {t('webinar.form.cancel')}
          </Link>
        ) : (
          <Link to="/webinars" className="type-body text-primary underline underline-offset-[0.2em]">
            {t('webinar.form.cancel')}
          </Link>
        )}
      </div>
    </form>
  );
}
