import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, FormErrorSummary, Heading, Input, Select, Skeleton, Switch, Text, useToast } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { PLATFORM_MINIMUM_COHORT } from '@nestself/contracts';
import type { ListeningConfigurationResponse, ListeningConfigurationUpdateRequest, QuestionnaireVersionResponse } from '@nestself/contracts';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { sampleClientConfiguration, sampleQuestionnaires } from './sample-listening-ops';
import { useClientConfiguration, useOperationsContext, useQuestionnaires, useUpdateClientConfiguration } from './use-listening-ops';

export interface ClientConfigurationScreenProps {
  listeningApi: ListeningApi;
  /** The organization from the URL; the server checks the caller may configure it. */
  orgId: string;
  /** Sample mode: fixtures instead of the API, and saving disabled. */
  sampleMode: boolean;
}

/** The contract's ranges (`policyNumbers` in `@nestself/contracts`). */
const RANGES = {
  cadenceDays: { min: 7, max: 365 },
  responseWindowDays: { min: 1, max: 60 },
  reminderLimit: { min: 0, max: 2 },
  freshnessDays: { min: 7, max: 365 },
  minimumCohort: { min: PLATFORM_MINIMUM_COHORT, max: 1000 },
} as const;
type NumberField = keyof typeof RANGES;
const NUMBER_FIELDS: readonly NumberField[] = ['cadenceDays', 'responseWindowDays', 'reminderLimit', 'freshnessDays', 'minimumCohort'];

type Capability = 'measurement' | 'feedback' | 'workplaceReviews';
const CAPABILITIES: readonly Capability[] = ['measurement', 'feedback', 'workplaceReviews'];
const WINDOW_KEYS: Record<Capability, { from: 'measurementFrom' | 'feedbackFrom' | 'workplaceReviewsFrom'; until: 'measurementUntil' | 'feedbackUntil' | 'workplaceReviewsUntil' }> = {
  measurement: { from: 'measurementFrom', until: 'measurementUntil' },
  feedback: { from: 'feedbackFrom', until: 'feedbackUntil' },
  workplaceReviews: { from: 'workplaceReviewsFrom', until: 'workplaceReviewsUntil' },
};
const NONE = 'none';

/** `YYYY-MM-DD` for a date input, from an ISO instant (the day in UTC, as the API stores midnight UTC). */
export function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}
/** Midnight UTC of a date input, or null for an empty one. */
export function fromDateInput(value: string): string | null {
  return value ? `${value}T00:00:00.000Z` : null;
}
/** `YYYY-MM-DDTHH:mm` in the browser's zone for a datetime-local input. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Tenths of a percent as the form shows them ("75.0"). */
export function tenthsToPercent(tenths: number): string {
  return (tenths / 10).toFixed(1);
}
/** The form's percent text as integer tenths, or null when it is not a number in 0..100. */
export function percentToTenths(text: string): number | null {
  if (!/^\d{1,3}(\.\d)?$/.test(text.trim())) return null;
  const tenths = Math.round(Number(text) * 10);
  return tenths >= 0 && tenths <= 1000 ? tenths : null;
}

interface FormState {
  windows: Record<Capability, { from: string; until: string }>;
  feedbackSensitiveEnabled: boolean;
  numbers: Record<NumberField, string>;
  goodPercent: string;
  monitorPercent: string;
  questionnaireVersionId: string;
  nextLaunchLocal: string;
}

function formStateOf(config: ListeningConfigurationResponse): FormState {
  return {
    windows: {
      measurement: { from: toDateInput(config.measurementFrom), until: toDateInput(config.measurementUntil) },
      feedback: { from: toDateInput(config.feedbackFrom), until: toDateInput(config.feedbackUntil) },
      workplaceReviews: { from: toDateInput(config.workplaceReviewsFrom), until: toDateInput(config.workplaceReviewsUntil) },
    },
    feedbackSensitiveEnabled: config.feedbackSensitiveEnabled,
    numbers: {
      cadenceDays: String(config.cadenceDays),
      responseWindowDays: String(config.responseWindowDays),
      reminderLimit: String(config.reminderLimit),
      freshnessDays: String(config.freshnessDays),
      minimumCohort: String(config.minimumCohort),
    },
    goodPercent: tenthsToPercent(config.goodThresholdTenths),
    monitorPercent: tenthsToPercent(config.monitorThresholdTenths),
    questionnaireVersionId: config.questionnaireVersionId ?? NONE,
    nextLaunchLocal: toLocalInput(config.nextLaunchAt),
  };
}

/**
 * One client's listening entitlements and reporting rules (CFG-01, CFG-03),
 * from the operations workspace. Only changed fields are sent; the server
 * bumps the policy version and the next cycles use it. The minimum cohort
 * never goes below the platform floor, and the form refuses it before the
 * server does.
 */
export function ClientConfigurationScreen({ listeningApi, orgId, sampleMode }: ClientConfigurationScreenProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const apiOrgId = ready ? orgId : null;
  const query = useClientConfiguration(listeningApi, apiOrgId);
  // Only published versions can be assigned; a viewer without `listening.templates.write` gets a plain id instead of a list.
  const questionnaires = useQuestionnaires(listeningApi, ready);

  const header = (
    <div className="space-y-2">
      <Heading level={3}>{t('listening:clientConfig.title')}</Heading>
      <Text tone="secondary">{t('listening:clientConfig.lead')}</Text>
    </div>
  );

  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : null;
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title={key ? t(key) : t('listening:errors.unknown')}>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            {t('common:action.retry')}
          </Button>
        </Alert>
      </div>
    );
  }
  const config = sampleMode ? sampleClientConfiguration(orgId) : query.data;
  if (!config) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={8} label={t('common:state.loading')} />
      </div>
    );
  }
  const versions = sampleMode ? sampleQuestionnaires() : (questionnaires.data ?? []);
  return (
    <div className="space-y-6">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:clientConfig.sampleNote')}</Alert> : null}
      <ConfigurationForm
        key={`${config.policyVersion}-${config.updatedAt}`}
        listeningApi={listeningApi}
        orgId={orgId}
        config={config}
        versions={versions}
        sampleMode={sampleMode}
      />
    </div>
  );
}

interface ConfigurationFormProps {
  listeningApi: ListeningApi;
  orgId: string;
  config: ListeningConfigurationResponse;
  versions: readonly QuestionnaireVersionResponse[];
  sampleMode: boolean;
}

function ConfigurationForm({ listeningApi, orgId, config, versions, sampleMode }: ConfigurationFormProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const update = useUpdateClientConfiguration(listeningApi);
  const idPrefix = useId();
  const [state, setState] = useState<FormState>(() => formStateOf(config));
  const [errors, setErrors] = useState<FormError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  // Read the clock once per mount so the three capability badges agree on "now".
  const [now] = useState(() => Date.now());

  const id = (name: string) => `${idPrefix}-${name}`;
  const errorFor = (name: string) => errors.find((e) => e.id === id(name))?.message;
  const label = (key: string, opts?: Record<string, unknown>) => t(`listening:clientConfig.${key}`, opts);

  const enabled = (from: string | null, until: string | null) =>
    !!from && new Date(from).getTime() <= now && (!until || now < new Date(until).getTime());

  const publishedVersions = versions.filter((v) => v.status === 'published');
  const currentKnown = !config.questionnaireVersionId || publishedVersions.some((v) => v.id === config.questionnaireVersionId);
  const questionnaireOptions = [
    { value: NONE, label: label('questionnaireNone') },
    ...publishedVersions.map((v) => ({ value: v.id, label: t('listening:questionnaires.version', { version: v.version }) })),
    ...(currentKnown ? [] : [{ value: config.questionnaireVersionId!, label: label('questionnaireUnknown', { id: config.questionnaireVersionId }) }]),
  ];

  /** The request body with only the changed fields, plus the problems that stop it. */
  const build = (): { body: ListeningConfigurationUpdateRequest; problems: FormError[] } => {
    const body: ListeningConfigurationUpdateRequest = {};
    const problems: FormError[] = [];
    const problem = (name: string, fieldLabel: string, message: string) => problems.push({ id: id(name), label: fieldLabel, message });

    for (const cap of CAPABILITIES) {
      const { from, until } = WINDOW_KEYS[cap];
      const fromIso = fromDateInput(state.windows[cap].from);
      const untilIso = fromDateInput(state.windows[cap].until);
      if (fromIso && untilIso && untilIso <= fromIso) problem(`${cap}-until`, `${label(cap)}: ${label('until')}`, label('errors.dates'));
      if (fromIso !== config[from]) body[from] = fromIso;
      if (untilIso !== config[until]) body[until] = untilIso;
    }
    if (state.feedbackSensitiveEnabled !== config.feedbackSensitiveEnabled) body.feedbackSensitiveEnabled = state.feedbackSensitiveEnabled;

    const numbers: Partial<Record<NumberField, number>> = {};
    for (const field of NUMBER_FIELDS) {
      const text = state.numbers[field].trim();
      const value = /^\d+$/.test(text) ? Number(text) : NaN;
      const { min, max } = RANGES[field];
      if (Number.isNaN(value) || value < min || value > max) {
        problem(field, label(field), field === 'minimumCohort' && !Number.isNaN(value) && value < min ? label('errors.minimumCohort', { min }) : label('errors.number', { min, max }));
        continue;
      }
      numbers[field] = value;
      if (value !== config[field]) body[field] = value;
    }
    const cadence = numbers.cadenceDays;
    const window = numbers.responseWindowDays;
    if (cadence !== undefined && window !== undefined && window > cadence) problem('responseWindowDays', label('window'), label('errors.window'));

    const good = percentToTenths(state.goodPercent);
    const monitor = percentToTenths(state.monitorPercent);
    if (good === null) problem('goodThreshold', label('goodThreshold'), label('errors.percent'));
    if (monitor === null) problem('monitorThreshold', label('monitorThreshold'), label('errors.percent'));
    if (good !== null && monitor !== null) {
      if (monitor >= good) problem('monitorThreshold', label('monitorThreshold'), label('errors.thresholds'));
      if (good !== config.goodThresholdTenths) body.goodThresholdTenths = good;
      if (monitor !== config.monitorThresholdTenths) body.monitorThresholdTenths = monitor;
    }

    const questionnaireVersionId = state.questionnaireVersionId === NONE ? null : state.questionnaireVersionId;
    if (questionnaireVersionId !== config.questionnaireVersionId) body.questionnaireVersionId = questionnaireVersionId;

    let nextLaunchAt: string | null = null;
    if (state.nextLaunchLocal) {
      const d = new Date(state.nextLaunchLocal);
      if (Number.isNaN(d.getTime())) problem('nextLaunchAt', label('nextLaunch'), label('errors.dateTime'));
      else nextLaunchAt = d.toISOString();
    }
    if (nextLaunchAt !== config.nextLaunchAt) body.nextLaunchAt = nextLaunchAt;

    return { body, problems };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (sampleMode || update.isPending) return;
    const { body, problems } = build();
    setErrors(problems);
    setFormError(null);
    if (problems.length > 0) return;
    if (Object.keys(body).length === 0) {
      setFormError(label('nothingChanged'));
      return;
    }
    try {
      const saved = await update.mutateAsync({ orgId, body });
      addToast({ title: label('saved', { version: saved.policyVersion }), tone: 'success' });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      // A cancelled step-up is not a failure: the form keeps its values and shows nothing.
      if (key) setFormError(t(key));
    }
  };

  const setWindow = (cap: Capability, part: 'from' | 'until', value: string) =>
    setState((s) => ({ ...s, windows: { ...s.windows, [cap]: { ...s.windows[cap], [part]: value } } }));
  const setNumber = (field: NumberField, value: string) => setState((s) => ({ ...s, numbers: { ...s.numbers, [field]: value } }));

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-8">
      <Text tone="secondary" typeRole="metadata">
        {label('state', { version: config.policyVersion, date: formatDateTime(config.updatedAt, locale) })}
      </Text>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      {errors.length > 0 ? <FormErrorSummary title={label('errorsTitle')} errors={errors} /> : null}

      <fieldset className="space-y-4">
        <legend className="type-label text-text">{label('capabilities')}</legend>
        <Text tone="secondary" typeRole="metadata">
          {label('capabilitiesHint')}
        </Text>
        {CAPABILITIES.map((cap) => {
          const { from, until } = WINDOW_KEYS[cap];
          const on = enabled(config[from], config[until]);
          return (
            <div key={cap} className="grid gap-3 rounded-card border border-border-subtle p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <span className="type-label text-text">{label(cap)}</span>
                <Badge tone={on ? 'success' : 'neutral'}>{on ? t('listening:settings.enabled') : t('listening:settings.disabled')}</Badge>
              </div>
              <Field label={`${label(cap)}: ${label('from')}`} id={id(`${cap}-from`)}>
                <Input type="date" value={state.windows[cap].from} onChange={(e) => setWindow(cap, 'from', e.target.value)} disabled={sampleMode} />
              </Field>
              <Field label={`${label(cap)}: ${label('until')}`} id={id(`${cap}-until`)} error={errorFor(`${cap}-until`)}>
                <Input type="date" value={state.windows[cap].until} onChange={(e) => setWindow(cap, 'until', e.target.value)} disabled={sampleMode} />
              </Field>
            </div>
          );
        })}
        <div className="space-y-1">
          <Switch checked={state.feedbackSensitiveEnabled} onCheckedChange={(v) => setState((s) => ({ ...s, feedbackSensitiveEnabled: v }))} disabled={sampleMode}>
            {label('sensitive')}
          </Switch>
          <Text tone="secondary" typeRole="metadata">
            {label('sensitiveHint')}
          </Text>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="type-label text-text">{label('rules')}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBER_FIELDS.map((field) => (
            <Field
              key={field}
              label={label(field === 'responseWindowDays' ? 'window' : field === 'cadenceDays' ? 'cadence' : field === 'reminderLimit' ? 'reminders' : field === 'freshnessDays' ? 'freshness' : 'minimumCohort')}
              id={id(field)}
              error={errorFor(field)}
              description={field === 'minimumCohort' ? label('minimumCohortHint', { min: PLATFORM_MINIMUM_COHORT }) : undefined}
              required
            >
              <Input type="number" value={state.numbers[field]} onChange={(e) => setNumber(field, e.target.value)} disabled={sampleMode} />
            </Field>
          ))}
          <Field label={label('goodThreshold')} id={id('goodThreshold')} error={errorFor('goodThreshold')} description={label('thresholdHint')} required>
            <Input value={state.goodPercent} onChange={(e) => setState((s) => ({ ...s, goodPercent: e.target.value }))} disabled={sampleMode} />
          </Field>
          <Field label={label('monitorThreshold')} id={id('monitorThreshold')} error={errorFor('monitorThreshold')} required>
            <Input value={state.monitorPercent} onChange={(e) => setState((s) => ({ ...s, monitorPercent: e.target.value }))} disabled={sampleMode} />
          </Field>
          <Field label={label('questionnaire')} id={id('questionnaireVersionId')} description={label('questionnaireHint')}>
            <Select
              options={questionnaireOptions}
              value={state.questionnaireVersionId}
              onValueChange={(v) => setState((s) => ({ ...s, questionnaireVersionId: v ?? NONE }))}
              disabled={sampleMode}
            />
          </Field>
          <Field label={label('nextLaunch')} id={id('nextLaunchAt')} error={errorFor('nextLaunchAt')} description={label('nextLaunchHint', { zone: config.timeZone })}>
            <Input type="datetime-local" value={state.nextLaunchLocal} onChange={(e) => setState((s) => ({ ...s, nextLaunchLocal: e.target.value }))} disabled={sampleMode} />
          </Field>
        </div>
        {/* The time zone comes from the organization record and is not part of the listening configuration. */}
        <Text tone="secondary" typeRole="metadata">
          {t('listening:settings.timeZone', { zone: config.timeZone })}
        </Text>
      </fieldset>

      <div>
        <Button variant="primary" type="submit" disabled={sampleMode || update.isPending}>
          {update.isPending ? label('saving') : label('save')}
        </Button>
      </div>
    </form>
  );
}
