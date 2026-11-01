import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Card,
  DataList,
  Field,
  Heading,
  Input,
  RadioGroup,
  RadioItem,
  Select,
  Skeleton,
  Text,
  Textarea,
  useToast,
} from '@nestself/ui';
import {
  ACTIVE_REVIEW_ENGAGEMENT_STATUSES,
  REVIEW_MAX_WINDOWS,
  type ReviewEngagementResponse,
  type ReviewRequestOpsResponse,
  type ReviewScopeCreateRequest,
  type ReviewServiceView,
  type ReviewTriageRequest,
} from '@nestself/contracts';
import { formatDate, formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useDebounced } from '../../use-debounced';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { localized } from '../listening/localized';
import { ENGAGEMENT_TONE, REQUEST_TONE, SCOPE_TONE, engagementStatusKey, priceLabel, requestStatusKey, scopeLabel, scopeStatusKey } from './review-labels';
import { sampleCandidates, sampleOpsEngagement, sampleOpsRequest, sampleServices } from './sample-reviews-ops';
import {
  useAssignReviewer,
  useOperationsContext,
  useOpsCancelEngagement,
  useOpsEngagement,
  useOpsReviewRequest,
  useOpsReviewServices,
  useProposeWindows,
  useReviewerCandidates,
  useSendScope,
  useTriage,
} from './use-reviews-ops';

export interface RequestDetailScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  requestId: string;
}

type TriageChoice = ReviewTriageRequest['status'];
const TRIAGEABLE = ['submitted', 'needs_information', 'in_review'] as const;
const SCOPEABLE = ['in_review', 'scoped'] as const;

/** `YYYY-MM-DDTHH:mm` in the browser's zone for a datetime-local input. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** The instant of a datetime-local value (browser zone), or null when empty or malformed. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** The price field as integer cents: empty keeps the quote open (`null`), anything else must be a whole non-negative number. */
export function parsePriceMinor(text: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  return /^\d+$/.test(trimmed) ? { ok: true, value: Number(trimmed) } : { ok: false };
}

/**
 * One request as the coordinator sees it (spec REV-03, REV-05, REV-06): the
 * requester's context and consent, triage with the employer-facing texts,
 * versioned scopes with their price, and, once a scope is accepted, the
 * engagement: reviewer assignment (qualified reviewers only), proposed
 * meeting windows and cancellation.
 */
export function RequestDetailScreen({ listeningApi, sampleMode, requestId }: RequestDetailScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const query = useOpsReviewRequest(listeningApi, ready ? requestId : null);
  const servicesQuery = useOpsReviewServices(listeningApi, ready);
  const data: ReviewRequestOpsResponse | undefined = sampleMode ? sampleOpsRequest(requestId) : query.data;
  const services: ReviewServiceView[] | undefined = sampleMode ? sampleServices() : servicesQuery.data?.items;

  const back = (
    <Link to="/workplace-reviews" className="type-label text-primary underline">
      {t('listening:reviewOps.request.back')}
    </Link>
  );
  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : null;
    return (
      <div className="space-y-6">
        {back}
        <Alert tone="danger">{key ? t(key) : t('listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-6">
        {back}
        {sampleMode ? <Alert tone="danger">{t('listening:errors.notFound')}</Alert> : <Skeleton lines={8} label={t('common:state.loading')} />}
      </div>
    );
  }
  return (
    <div className="space-y-8">
      {back}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level={1}>{t('listening:reviewOps.request.title', { organization: data.organizationName })}</Heading>
          <Badge tone={REQUEST_TONE[data.status]}>{t(requestStatusKey(data.status))}</Badge>
        </div>
        <Text tone="secondary">
          {scopeLabel(t, data.scopeCohortKey)} · {data.dimensionKeys.map((k) => t(`listening:dimensions.${k}.title`)).join(', ')}
        </Text>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:reviewOps.request.requester', { name: data.requesterFirstName ?? '—' })} · {t('listening:reviews.detail.requested', { date: formatDate(data.createdAt, locale) })} ·{' '}
          {t('listening:reviewOps.request.snapshots', { count: data.snapshotIds.length })}
        </Text>
      </div>
      {sampleMode ? <Alert tone="info">{t('listening:reviewOps.queue.sampleNote')}</Alert> : null}
      <Alert tone={data.shareAggregates ? 'info' : 'warning'}>{t(data.shareAggregates ? 'listening:reviewOps.request.share' : 'listening:reviewOps.request.noShare')}</Alert>

      <Card padding="md" tone="subtle" className="space-y-1">
        <Text typeRole="label">{t('listening:reviewOps.request.context')}</Text>
        <Text className="whitespace-pre-line">{data.context ?? t('listening:reviewOps.request.noContext')}</Text>
      </Card>
      {data.informationRequest ? (
        <Card padding="md" tone="subtle" className="space-y-1">
          <Text typeRole="label">{t('listening:reviews.detail.informationNeeded')}</Text>
          <Text className="whitespace-pre-line">{data.informationRequest}</Text>
          {data.informationAnswer ? (
            <>
              <Text typeRole="label">{t('listening:reviewOps.request.answer')}</Text>
              <Text className="whitespace-pre-line">{data.informationAnswer}</Text>
            </>
          ) : null}
        </Card>
      ) : null}
      {data.declineReason ? <Alert tone="warning">{t('listening:reviews.detail.declined', { reason: data.declineReason })}</Alert> : null}

      {(TRIAGEABLE as readonly string[]).includes(data.status) ? <TriageForm listeningApi={listeningApi} sampleMode={sampleMode} request={data} /> : null}

      <section aria-labelledby="ops-scopes" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="ops-scopes">
          {t('listening:reviewOps.request.scopes')}
        </Heading>
        {data.scopes.length === 0 ? <Text tone="secondary">{t('listening:reviewOps.request.noScopes')}</Text> : null}
        {[...data.scopes].reverse().map((scope) => (
          <Card key={scope.id} as="article" padding="md" className="space-y-2" aria-label={`${t('listening:reviews.detail.scope.version', { version: scope.version })}: ${scope.title}`}>
            <div className="flex flex-wrap items-center gap-3">
              <Heading level={3} typeRole="sectionTitle">
                {scope.title}
              </Heading>
              <Badge tone={SCOPE_TONE[scope.status]}>{t(scopeStatusKey(scope.status))}</Badge>
              <Text tone="secondary" typeRole="metadata">
                {t('listening:reviews.detail.scope.version', { version: scope.version })}
              </Text>
            </div>
            <DataList
              items={[
                { term: t('listening:reviews.detail.scope.deliverables'), description: scope.deliverables },
                { term: t('listening:reviews.detail.scope.participants'), description: scope.participants },
                { term: t('listening:reviews.detail.scope.price'), description: priceLabel(t, scope, locale), numeric: true },
                { term: t('listening:reviews.detail.scope.terms', { version: scope.termsVersion }), description: t('listening:reviews.detail.scope.validUntil', { date: formatDateTime(scope.validUntil, locale) }) },
              ]}
            />
          </Card>
        ))}
        {(SCOPEABLE as readonly string[]).includes(data.status) && services ? <ScopeForm listeningApi={listeningApi} sampleMode={sampleMode} request={data} services={services} locale={locale} /> : null}
      </section>

      {data.engagementId ? <EngagementSection listeningApi={listeningApi} sampleMode={sampleMode} request={data} engagementId={data.engagementId} services={services ?? []} locale={locale} ready={ready} /> : null}
    </div>
  );
}

interface TriageFormProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  request: ReviewRequestOpsResponse;
}

function TriageForm({ listeningApi, sampleMode, request }: TriageFormProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const triage = useTriage(listeningApi, request.id);
  const [choice, setChoice] = useState<TriageChoice>('in_review');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsText = choice !== 'in_review';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (needsText && !text.trim()) {
      setError(t('listening:reviewOps.request.errors.required'));
      return;
    }
    if (sampleMode) {
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    const body: ReviewTriageRequest =
      choice === 'needs_information' ? { status: choice, informationRequest: text.trim() } : choice === 'declined' ? { status: choice, declineReason: text.trim() } : { status: choice };
    try {
      await triage.mutateAsync(body);
      setText('');
      addToast({ title: t('listening:reviewOps.request.triaged'), tone: 'success' });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setError(t(key));
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3 rounded-card border border-border-subtle p-4" aria-labelledby="ops-triage">
      <Heading level={2} typeRole="sectionTitle" id="ops-triage">
        {t('listening:reviewOps.request.triage')}
      </Heading>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <RadioGroup label={t('listening:reviewOps.request.triage')} value={choice} onValueChange={(v) => setChoice(v as TriageChoice)}>
        <RadioItem value="in_review">{t('listening:reviewOps.request.takeInReview')}</RadioItem>
        <RadioItem value="needs_information">{t('listening:reviewOps.request.needInfo')}</RadioItem>
        <RadioItem value="declined">{t('listening:reviewOps.request.decline')}</RadioItem>
      </RadioGroup>
      {needsText ? (
        <Field label={choice === 'needs_information' ? t('listening:reviewOps.request.infoText') : t('listening:reviewOps.request.declineReason')} id="ops-triage-text" required>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        </Field>
      ) : null}
      <Button variant="primary" type="submit" disabled={triage.isPending}>
        {t('listening:reviewOps.request.apply')}
      </Button>
    </form>
  );
}

interface ScopeFormProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  request: ReviewRequestOpsResponse;
  services: ReviewServiceView[];
  locale: Locale;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ScopeForm({ listeningApi, sampleMode, request, services, locale }: ScopeFormProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const idPrefix = useId();
  const send = useSendScope(listeningApi, request.id);
  const initialService = services.find((s) => s.id === request.serviceId) ?? services[0];
  const [serviceId, setServiceId] = useState(initialService?.id ?? '');
  const service = services.find((s) => s.id === serviceId) ?? initialService;
  const [title, setTitle] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [participants, setParticipants] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<'EUR' | 'RSD'>('EUR');
  const [taxNote, setTaxNote] = useState('');
  const [termsVersion, setTermsVersion] = useState(initialService?.termsVersion ?? '');
  const [validUntil, setValidUntil] = useState(() => toLocalInput(new Date(Date.now() + 14 * DAY_MS).toISOString()));
  const [cancellationPolicy, setCancellationPolicy] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsedPrice = parsePriceMinor(price);
    const until = fromLocalInput(validUntil);
    if (!service || !title.trim() || !deliverables.trim() || !participants.trim() || !termsVersion.trim() || !cancellationPolicy.trim() || !until || !parsedPrice.ok) {
      setError(t('listening:reviewOps.request.errors.required'));
      return;
    }
    if (sampleMode) {
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    const body: ReviewScopeCreateRequest = {
      serviceId: service.id,
      title: title.trim(),
      deliverables: deliverables.trim(),
      participants: participants.trim(),
      priceMinor: parsedPrice.value,
      currency,
      taxNote: taxNote.trim() || null,
      termsVersion: termsVersion.trim(),
      validUntil: until,
      cancellationPolicy: cancellationPolicy.trim(),
    };
    try {
      await send.mutateAsync(body);
      setTitle('');
      setDeliverables('');
      setParticipants('');
      setPrice('');
      setTaxNote('');
      setCancellationPolicy('');
      addToast({ title: t('listening:reviewOps.request.scope.sent'), tone: 'success' });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setError(t(key));
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3 rounded-card border border-border-subtle p-4" aria-labelledby={`${idPrefix}-scope`}>
      <Heading level={3} typeRole="sectionTitle" id={`${idPrefix}-scope`}>
        {t('listening:reviewOps.request.sendScope')}
      </Heading>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label={t('listening:reviewOps.request.scope.service')} id={`${idPrefix}-service`} required>
        <Select
          options={services.map((s) => ({ value: s.id, label: `${localized(s.name, locale)} · ${priceLabel(t, s, locale)}` }))}
          value={serviceId}
          onValueChange={(v) => {
            if (!v) return;
            setServiceId(v);
            const next = services.find((s) => s.id === v);
            if (next) setTermsVersion(next.termsVersion);
          }}
        />
      </Field>
      <Field label={t('listening:reviewOps.request.scope.title')} id={`${idPrefix}-title`} required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('listening:reviewOps.request.scope.deliverables')} id={`${idPrefix}-deliverables`} required>
        <Textarea value={deliverables} onChange={(e) => setDeliverables(e.target.value)} rows={3} />
      </Field>
      <Field label={t('listening:reviewOps.request.scope.participants')} id={`${idPrefix}-participants`} required>
        <Input value={participants} onChange={(e) => setParticipants(e.target.value)} maxLength={1000} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('listening:reviewOps.request.scope.price')} id={`${idPrefix}-price`} description={t('listening:reviewOps.request.scope.priceHint')}>
          <Input value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label={t('listening:reviewOps.request.scope.currency')} id={`${idPrefix}-currency`}>
          <Select options={[{ value: 'EUR', label: 'EUR' }, { value: 'RSD', label: 'RSD' }]} value={currency} onValueChange={(v) => v && setCurrency(v as 'EUR' | 'RSD')} />
        </Field>
      </div>
      <Field label={t('listening:reviewOps.request.scope.taxNote')} id={`${idPrefix}-tax`}>
        <Input value={taxNote} onChange={(e) => setTaxNote(e.target.value)} maxLength={500} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('listening:reviewOps.request.scope.terms')} id={`${idPrefix}-terms`} required>
          <Input value={termsVersion} onChange={(e) => setTermsVersion(e.target.value)} maxLength={40} />
        </Field>
        <Field label={t('listening:reviewOps.request.scope.validUntil')} id={`${idPrefix}-valid`} required>
          <Input type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
      </div>
      <Field label={t('listening:reviewOps.request.scope.cancellation')} id={`${idPrefix}-cancellation`} required>
        <Textarea value={cancellationPolicy} onChange={(e) => setCancellationPolicy(e.target.value)} rows={2} />
      </Field>
      <Button variant="primary" type="submit" disabled={send.isPending}>
        {t('listening:reviewOps.request.scope.send')}
      </Button>
    </form>
  );
}

interface EngagementSectionProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  request: ReviewRequestOpsResponse;
  engagementId: string;
  services: ReviewServiceView[];
  locale: Locale;
  ready: boolean;
}

function EngagementSection({ listeningApi, sampleMode, request, engagementId, services, locale, ready }: EngagementSectionProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const idPrefix = useId();
  const query = useOpsEngagement(listeningApi, ready ? engagementId : null);
  const engagement: ReviewEngagementResponse | undefined = sampleMode ? sampleOpsEngagement(engagementId) : query.data;
  const assign = useAssignReviewer(listeningApi, engagementId, request.id);
  const propose = useProposeWindows(listeningApi, engagementId, request.id);
  const cancel = useOpsCancelEngagement(listeningApi, engagementId, request.id);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const candidatesQuery = useReviewerCandidates(listeningApi, debouncedSearch, ready);
  const candidates = sampleMode ? sampleCandidates().items : (candidatesQuery.data?.items ?? []);
  const [pickedReviewerId, setReviewerId] = useState<string>('');
  // A pick that is no longer among the candidates (the search changed) counts as no pick.
  const reviewerId = candidates.some((c) => c.userId === pickedReviewerId) ? pickedReviewerId : '';
  const [starts, setStarts] = useState<string[]>(['']);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!sampleMode && query.isError) {
    return <Alert tone="danger">{t(listeningErrorMessageKey(query.error) ?? 'listening:errors.unknown')}</Alert>;
  }
  if (!engagement) return <Skeleton lines={4} label={t('common:state.loading')} />;

  const active = ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status);
  const durationMinutes = services.find((s) => s.id === engagement.scope.serviceId)?.durationMinutes ?? 60;
  const demo = () => addToast({ title: t('common:sample.demoNoop'), tone: 'info' });

  const onAssign = async () => {
    setError(null);
    if (!reviewerId) return;
    if (sampleMode) return demo();
    try {
      await assign.mutateAsync({ reviewerUserId: reviewerId });
      addToast({ title: t('listening:reviewOps.engagement.assigned'), tone: 'success' });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setError(t(key));
    }
  };

  const onPropose = async (event: FormEvent) => {
    event.preventDefault();
    setWindowError(null);
    const instants = starts.map(fromLocalInput);
    if (instants.length === 0 || instants.some((s) => s === null)) {
      setWindowError(t('listening:reviewOps.engagement.errors.windowRequired'));
      return;
    }
    if (sampleMode) return demo();
    try {
      await propose.mutateAsync({
        windows: instants.map((s) => ({ startsAt: s!, endsAt: new Date(new Date(s!).getTime() + durationMinutes * 60_000).toISOString() })),
        timeZone,
      });
      setStarts(['']);
      addToast({ title: t('listening:reviewOps.engagement.proposed'), tone: 'success' });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setWindowError(t(key));
    }
  };

  const onCancel = async () => {
    setError(null);
    if (sampleMode) {
      setCancelOpen(false);
      return demo();
    }
    try {
      await cancel.mutateAsync({});
      setCancelOpen(false);
    } catch (err) {
      setCancelOpen(false);
      const key = listeningErrorMessageKey(err);
      if (key) setError(t(key));
    }
  };

  return (
    <section aria-labelledby={`${idPrefix}-engagement`} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-engagement`}>
          {t('listening:reviewOps.engagement.title')}
        </Heading>
        <Badge tone={ENGAGEMENT_TONE[engagement.status]}>{t(engagementStatusKey(engagement.status))}</Badge>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <DataList
        items={[
          { term: t('listening:reviewOps.engagement.reviewer'), description: engagement.reviewerFirstName ?? t('listening:reviewOps.engagement.noReviewer') },
          {
            term: t('listening:reviewOps.engagement.meeting'),
            description: engagement.appointment
              ? t('listening:reviews.engagement.meetingAt', { date: formatDateTime(engagement.appointment.startsAt, locale), zone: engagement.appointment.timeZone })
              : t('listening:reviewOps.engagement.noMeeting'),
          },
        ]}
      />
      {engagement.proposedWindows && engagement.proposedWindows.length > 0 && !engagement.appointment ? (
        <div className="space-y-1">
          <Text typeRole="label">{t('listening:reviewOps.engagement.proposedList')}</Text>
          <ul className="list-disc pl-5">
            {engagement.proposedWindows.map((w) => (
              <li key={w.startsAt}>
                <Text>{formatDateTime(w.startsAt, locale)}</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {active ? (
        <>
          <div className="space-y-3 rounded-card border border-border-subtle p-4">
            <Heading level={3} typeRole="sectionTitle">
              {t('listening:reviewOps.engagement.assign')}
            </Heading>
            <Field label={t('listening:reviewOps.engagement.search')} id={`${idPrefix}-search`}>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            {candidates.length === 0 ? (
              <Text tone="secondary">{t('listening:reviewOps.engagement.noCandidates')}</Text>
            ) : (
              <Field label={t('listening:reviewOps.engagement.pickReviewer')} id={`${idPrefix}-reviewer`}>
                <Select
                  options={candidates.map((c) => ({ value: c.userId, label: c.displayName }))}
                  placeholder={t('listening:reviewOps.engagement.pickReviewer')}
                  value={reviewerId}
                  onValueChange={(v) => setReviewerId(v ?? '')}
                />
              </Field>
            )}
            <Button variant="primary" onClick={() => void onAssign()} disabled={!reviewerId || assign.isPending}>
              {t('listening:reviewOps.engagement.assign')}
            </Button>
          </div>

          <form onSubmit={(e) => void onPropose(e)} noValidate className="space-y-3 rounded-card border border-border-subtle p-4" aria-labelledby={`${idPrefix}-windows`}>
            <Heading level={3} typeRole="sectionTitle" id={`${idPrefix}-windows`}>
              {t('listening:reviewOps.engagement.windows')}
            </Heading>
            <Text tone="secondary">{t('listening:reviewOps.engagement.windowsLead', { zone: timeZone })}</Text>
            {windowError ? <Alert tone="danger">{windowError}</Alert> : null}
            {starts.map((value, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <Field label={`${t('listening:reviewOps.engagement.window', { n: i + 1 })}: ${t('listening:reviewOps.engagement.start')}`} id={`${idPrefix}-window-${i}`} required>
                  <Input type="datetime-local" value={value} onChange={(e) => setStarts((s) => s.map((v, j) => (j === i ? e.target.value : v)))} />
                </Field>
                {starts.length > 1 ? (
                  <Button variant="ghost" size="sm" type="button" onClick={() => setStarts((s) => s.filter((_, j) => j !== i))}>
                    {t('listening:reviewOps.engagement.removeWindow')}
                  </Button>
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              {starts.length < REVIEW_MAX_WINDOWS ? (
                <Button variant="secondary" type="button" onClick={() => setStarts((s) => [...s, ''])}>
                  {t('listening:reviewOps.engagement.addWindow')}
                </Button>
              ) : null}
              <Button variant="primary" type="submit" disabled={propose.isPending}>
                {t('listening:reviewOps.engagement.propose')}
              </Button>
            </div>
          </form>

          <div>
            <Button variant="ghost" onClick={() => setCancelOpen(true)}>
              {t('listening:reviewOps.engagement.cancel')}
            </Button>
          </div>
          <AlertDialog open={cancelOpen} onOpenChange={(open) => !open && !cancel.isPending && setCancelOpen(false)}>
            <AlertDialogContent
              title={t('listening:reviewOps.engagement.cancelTitle')}
              description={t('listening:reviewOps.engagement.cancelBody')}
              confirmLabel={t('listening:reviewOps.engagement.cancelConfirm')}
              cancelLabel={t('common:action.cancel')}
              destructive
              onConfirm={() => void onCancel()}
              confirmPending={cancel.isPending}
            />
          </AlertDialog>
        </>
      ) : null}
    </section>
  );
}
