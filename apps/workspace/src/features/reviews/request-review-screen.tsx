import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Checkbox, Field, FormErrorSummary, Heading, Select, Skeleton, StatusBlock, Switch, Text, Textarea, buttonClassNames } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import {
  LISTENING_DIMENSION_KEYS,
  REVIEW_CONTEXT_MAX,
  type ListeningDimensionKey,
  type ListeningOverviewResponse,
  type ReviewRequestResponse,
  type ReviewServicesResponse,
} from '@nestself/contracts';
import { SAMPLE_LISTENING_OVERVIEW } from '@nestself/sample-data';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { useOverview } from '../listening/use-listening';
import { useOrgContext } from '../people/use-org-context';
import { REQUEST_TONE, localizedText, priceLabel, requestStatusKey } from './review-labels';
import { sampleReviewServices } from './sample-reviews';
import { useCreateReviewRequest, useReviewServices } from './use-reviews';
import { Badge } from '@nestself/ui';

export interface RequestReviewScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/**
 * The review request form (spec REV-02): the scope and the current published
 * result, the dimensions to look at, the service from the catalogue (a quote
 * when no price is configured, never a computed number), the explicit
 * difference between a request and a paid engagement, the data-sharing
 * choice, optional context and the terms. One send creates one request through
 * an idempotency key; an active request for the scope is linked instead.
 */
export function RequestReviewScreen({ listeningApi, sampleMode }: RequestReviewScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { orgId, apiOrgId, switchError } = useOrgContext(sampleMode);
  const overviewQuery = useOverview(listeningApi, apiOrgId);
  const servicesQuery = useReviewServices(listeningApi, apiOrgId);
  const overview: ListeningOverviewResponse | undefined = sampleMode ? SAMPLE_LISTENING_OVERVIEW : overviewQuery.data;
  const services: ReviewServicesResponse | undefined = sampleMode ? sampleReviewServices() : servicesQuery.data;

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:reviews.request.title')}</Heading>
      <Text tone="secondary">{t('listening:reviews.request.lead')}</Text>
    </div>
  );
  if (!sampleMode && (switchError || overviewQuery.isError || servicesQuery.isError)) {
    const key = listeningErrorMessageKey(overviewQuery.error ?? servicesQuery.error);
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{key ? t(key) : t('listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!overview || !services || orgId === null) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={8} label={t('common:state.loading')} />
      </div>
    );
  }
  if (!services.workplaceReviewsEnabled) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">{t('listening:errors.workplace_reviews_disabled')}</Alert>
      </div>
    );
  }
  if (!overview.current) {
    return (
      <div className="space-y-6">
        {header}
        <StatusBlock state="empty" title={t('listening:reviews.request.noSnapshot')} body={t('listening:reviews.emptyBody')} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:reviews.sampleNote')}</Alert> : null}
      <RequestForm listeningApi={listeningApi} sampleMode={sampleMode} orgId={orgId} overview={overview} services={services} locale={locale} />
    </div>
  );
}

interface RequestFormProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  orgId: string;
  overview: ListeningOverviewResponse;
  services: ReviewServicesResponse;
  locale: Locale;
}

function RequestForm({ listeningApi, sampleMode, orgId, overview, services, locale }: RequestFormProps) {
  const { t } = useTranslation(['listening', 'common']);
  const idPrefix = useId();
  const current = overview.current!;
  const create = useCreateReviewRequest(listeningApi, orgId);
  const red = useMemo(() => current.dimensions.filter((d) => d.status === 'danger').map((d) => d.key), [current]);
  const [dimensions, setDimensions] = useState<ListeningDimensionKey[]>(red.length > 0 ? red : [...LISTENING_DIMENSION_KEYS]);
  const [serviceId, setServiceId] = useState(services.items[0]?.id ?? '');
  const [share, setShare] = useState(true);
  const [context, setContext] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(overview.reviewOffer?.activeRequestId ?? null);
  const [receipt, setReceipt] = useState<ReviewRequestResponse | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const service = services.items.find((s) => s.id === serviceId) ?? services.items[0];
  const ids = { dimensions: `${idPrefix}-dimensions`, terms: `${idPrefix}-terms`, context: `${idPrefix}-context`, service: `${idPrefix}-service` };

  const toggle = (key: ListeningDimensionKey) => setDimensions((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problems: FormError[] = [];
    if (dimensions.length === 0) problems.push({ id: ids.dimensions, label: t('listening:reviews.request.dimensions'), message: t('listening:reviews.request.errors.dimensions') });
    if (!terms) problems.push({ id: ids.terms, label: t('listening:reviews.request.contact'), message: t('listening:reviews.request.errors.terms') });
    setErrors(problems);
    setApiError(null);
    if (problems.length > 0 || !service) return;
    const body = {
      snapshotIds: [current.snapshotId],
      scopeCohortKey: 'company',
      dimensionKeys: [...dimensions],
      serviceId: service.id,
      ...(context.trim() ? { context: context.trim() } : {}),
      shareAggregates: share,
      termsVersion: service.termsVersion,
      noticeVersion: service.termsVersion,
    };
    if (sampleMode) {
      setReceipt({ ...sampleReceipt(), dimensionKeys: body.dimensionKeys, shareAggregates: share });
      return;
    }
    try {
      setReceipt(await create.mutateAsync({ body, idempotencyKey }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_request_exists') {
        const existing = err.details?.['requestId'];
        setActiveRequestId(typeof existing === 'string' ? existing : null);
        setApiError(t('listening:reviews.request.active'));
        return;
      }
      const key = listeningErrorMessageKey(err);
      setApiError(key ? t(key) : t('listening:errors.unknown'));
    }
  };

  if (receipt) {
    return (
      <Card as="section" padding="lg" tone="brand" className="space-y-3" aria-labelledby={`${idPrefix}-receipt`}>
        <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-receipt`}>
          {t('listening:reviews.request.receipt.title')}
        </Heading>
        <Text>{t('listening:reviews.request.receipt.body', { status: t(requestStatusKey(receipt.status)) })}</Text>
        {sampleMode ? <Alert tone="info">{t('common:sample.demoNoop')}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          {sampleMode ? null : (
            <Link to="/listening/reviews/$requestId" params={{ requestId: receipt.id }} className={buttonClassNames({ variant: 'primary' })}>
              {t('listening:reviews.request.receipt.view')}
            </Link>
          )}
          <Link to="/listening/reviews" className={buttonClassNames({ variant: 'secondary' })}>
            {t('listening:reviews.request.receipt.back')}
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-6">
      <Alert tone="info">{t('listening:reviews.request.difference')}</Alert>
      {apiError ? (
        <Alert tone="warning">
          <span className="flex flex-wrap items-center gap-3">
            {apiError}
            {activeRequestId ? (
              <Link to="/listening/reviews/$requestId" params={{ requestId: activeRequestId }} className="type-label text-primary underline">
                {t('listening:reviews.request.viewActive')}
              </Link>
            ) : null}
          </span>
        </Alert>
      ) : null}
      {errors.length > 0 ? <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} /> : null}

      <Card padding="md" tone="subtle" className="space-y-2">
        <Text typeRole="label">{t('listening:reviews.request.scope')}</Text>
        <Text>{t('listening:reviews.scope.company')}</Text>
        <Text typeRole="label">{t('listening:reviews.request.periods')}</Text>
        <Text>{t('listening:reviews.request.period', { date: formatDate(current.closesAt, locale) })}</Text>
      </Card>

      <fieldset id={ids.dimensions} className="space-y-2" aria-describedby={errors.some((e) => e.id === ids.dimensions) ? `${ids.dimensions}-error` : undefined}>
        <legend className="type-label text-text">{t('listening:reviews.request.dimensions')}</legend>
        {LISTENING_DIMENSION_KEYS.map((key) => {
          const card = current.dimensions.find((d) => d.key === key);
          return (
            <Checkbox key={key} checked={dimensions.includes(key)} onCheckedChange={() => toggle(key)}>
              {t(`listening:dimensions.${key}.title`)}
              {card?.status ? ` (${t(`listening:status.${card.status}`)})` : ''}
            </Checkbox>
          );
        })}
        {errors.some((e) => e.id === ids.dimensions) ? (
          <Text tone="danger" typeRole="metadata" id={`${ids.dimensions}-error`}>
            {t('listening:reviews.request.errors.dimensions')}
          </Text>
        ) : null}
      </fieldset>

      <Field label={t('listening:reviews.request.service')} id={ids.service} description={t('listening:reviews.request.serviceHint')}>
        <Select
          options={services.items.map((s) => ({ value: s.id, label: `${localizedText(s.name, locale)} · ${priceLabel(t, s, locale)}` }))}
          value={serviceId}
          onValueChange={(v) => v && setServiceId(v)}
        />
      </Field>
      {service ? (
        <Card padding="md" tone="subtle" className="space-y-2" data-testid="service-summary">
          <Text>{localizedText(service.description, locale)}</Text>
          <Text tone="secondary" typeRole="metadata">
            {t('listening:reviews.request.duration', { minutes: service.durationMinutes })} · <Badge tone={service.pricing === 'free' ? 'success' : 'neutral'}>{priceLabel(t, service, locale)}</Badge>
          </Text>
          <Text tone="secondary" typeRole="metadata">
            {localizedText(service.termsText, locale)}
          </Text>
        </Card>
      ) : null}

      <div className="space-y-2">
        <Switch checked={share} onCheckedChange={setShare}>
          {t('listening:reviews.request.share')}
        </Switch>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:reviews.request.shareHint')}
        </Text>
      </div>

      <Field label={t('listening:reviews.request.context')} id={ids.context} description={t('listening:reviews.request.contextHint')}>
        <Textarea value={context} onChange={(e) => setContext(e.target.value.slice(0, REVIEW_CONTEXT_MAX))} rows={4} />
      </Field>

      <Text tone="secondary" typeRole="metadata">
        {t('listening:reviews.request.contact')}: {t('listening:reviews.request.contactHint')}
      </Text>

      <div id={ids.terms}>
        <Checkbox checked={terms} onCheckedChange={(v) => setTerms(v === true)}>
          {t('listening:reviews.request.terms', { version: service?.termsVersion ?? '' })}
        </Checkbox>
        {errors.some((e) => e.id === ids.terms) ? (
          <Text tone="danger" typeRole="metadata">
            {t('listening:reviews.request.errors.terms')}
          </Text>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t('listening:reviews.request.sending') : t('listening:reviews.request.submit')}
        </Button>
        <Link to="/listening/reviews" className={buttonClassNames({ variant: 'secondary' })}>
          {t('common:action.cancel')}
        </Link>
      </div>
    </form>
  );
}

function sampleReceipt(): ReviewRequestResponse {
  return {
    id: 'review_request_sample_new',
    status: 'submitted',
    scopeCohortKey: 'company',
    dimensionKeys: ['sustainable_workload'],
    snapshotIds: [],
    serviceId: null,
    shareAggregates: true,
    context: null,
    termsVersion: '2026-11',
    noticeVersion: '2026-11',
    createdAt: new Date().toISOString(),
    coordinatorFirstName: null,
    declineReason: null,
    informationRequest: null,
    informationAnswer: null,
    scopes: [],
    engagementId: null,
  };
}

export { REQUEST_TONE };
