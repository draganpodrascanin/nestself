import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Field,
  FormErrorSummary,
  Heading,
  PrivacyAtPointOfUse,
  RadioGroup,
  RadioItem,
  Select,
  Skeleton,
  StatusBlock,
  Switch,
  Text,
  Textarea,
  buttonClassNames,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { FEEDBACK_BODY_MAX, type FeedbackCaseCreateResponse, type FeedbackCaseKind, type FeedbackRouteChoice, type FeedbackRouteView } from '@nestself/contracts';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { categoryLabel, functionKey } from './case-labels';
import { sampleFeedbackRoutes } from './sample-feedback';
import { useCreateFeedbackCase, useFeedbackRoutes } from './use-feedback';

export interface FeedbackComposerScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/**
 * The composer (spec FBK-01, FBK-03, FBK-06): problem or suggestion, a
 * category, the recipient (the designated person or the independent
 * alternative, previewed by name before sending), the anonymity switch with
 * the warning that details can still identify the author, and the text.
 * Opening it creates nothing; one send creates one case, replayed on retry
 * through the idempotency key. The receipt shows the pseudonym, the function
 * that received it and the response target.
 */
export function FeedbackComposerScreen({ listeningApi, sampleMode }: FeedbackComposerScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const query = useFeedbackRoutes(listeningApi, !sampleMode);
  const routes = sampleMode ? sampleFeedbackRoutes() : query.data;

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:feedback.composer.title')}</Heading>
      <Text tone="secondary">{t('listening:feedback.composer.lead')}</Text>
    </div>
  );

  if (!sampleMode && query.isError) {
    const key = listeningErrorMessageKey(query.error);
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{key ? t(key) : t('listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!routes) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={6} label={t('common:state.loading')} />
      </div>
    );
  }
  if (!routes.feedbackEnabled || routes.items.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <StatusBlock state="empty" title={t('listening:feedback.composer.unavailable')} body={t('listening:feedback.composer.unavailableBody')} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:feedback.composer.sampleNote')}</Alert> : null}
      <ComposerForm listeningApi={listeningApi} sampleMode={sampleMode} routes={routes.items} locale={locale} />
    </div>
  );
}

interface ComposerFormProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  routes: readonly FeedbackRouteView[];
  locale: Locale;
}

function ComposerForm({ listeningApi, sampleMode, routes, locale }: ComposerFormProps) {
  const { t } = useTranslation(['listening', 'common']);
  const idPrefix = useId();
  const create = useCreateFeedbackCase(listeningApi);
  const [routeId, setRouteId] = useState(routes[0]!.id);
  const [kind, setKind] = useState<FeedbackCaseKind>('problem');
  const [category, setCategory] = useState('');
  const [choice, setChoice] = useState<FeedbackRouteChoice>('primary');
  const [anonymous, setAnonymous] = useState(true);
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<FeedbackCaseCreateResponse | null>(null);
  // One key per attempt: a retry of the same send replays the receipt; a new report gets a new key.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const route = routes.find((r) => r.id === routeId) ?? routes[0]!;
  const recipient = choice === 'primary' ? route.primary : route.alternate;
  const other = choice === 'primary' ? route.alternate : route.primary;
  const categoryOptions = useMemo(() => route.categories.map((c) => ({ value: c, label: categoryLabel(t, c) })), [route, t]);
  const ids = { category: `${idPrefix}-category`, body: `${idPrefix}-body`, route: `${idPrefix}-route` };

  const reset = () => {
    setReceipt(null);
    setBody('');
    setCategory('');
    setErrors([]);
    setApiError(null);
    setIdempotencyKey(crypto.randomUUID());
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problems: FormError[] = [];
    if (!category) problems.push({ id: ids.category, label: t('listening:feedback.composer.category'), message: t('listening:feedback.composer.errors.categoryRequired') });
    if (!body.trim()) problems.push({ id: ids.body, label: t('listening:feedback.composer.body'), message: t('listening:feedback.composer.errors.bodyRequired') });
    setErrors(problems);
    setApiError(null);
    if (problems.length > 0) return;
    const request = { routeId: route.id, kind, category, routeChoice: choice, anonymousToEmployer: anonymous, body: body.trim() };
    if (sampleMode) {
      setReceipt({ id: 'feedback_case_sample_new', pseudonym: 'Reporter-DEMO', state: 'submitted', dueAt: new Date(Date.now() + route.responseTargetHours * 3_600_000).toISOString(), handlerFunction: choice });
      return;
    }
    try {
      setReceipt(await create.mutateAsync({ body: request, idempotencyKey }));
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      setApiError(key ? t(key) : t('listening:errors.unknown'));
    }
  };

  if (receipt) {
    return (
      <Card as="section" padding="lg" tone="brand" className="space-y-3" aria-labelledby={`${idPrefix}-receipt`}>
        <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-receipt`}>
          {t('listening:feedback.composer.receipt.title')}
        </Heading>
        <Text>
          {receipt.dueAt
            ? t('listening:feedback.composer.receipt.body', { pseudonym: receipt.pseudonym, function: t(functionKey(receipt.handlerFunction)), date: formatDateTime(receipt.dueAt, locale) })
            : t('listening:feedback.composer.receipt.bodyNoDue', { pseudonym: receipt.pseudonym, function: t(functionKey(receipt.handlerFunction)) })}
        </Text>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:feedback.composer.receipt.note')}
        </Text>
        {sampleMode ? <Alert tone="info">{t('common:sample.demoNoop')}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          {sampleMode ? null : (
            <Link to="/feedback/$caseId" params={{ caseId: receipt.id }} className={buttonClassNames({ variant: 'primary' })}>
              {t('listening:feedback.composer.receipt.view')}
            </Link>
          )}
          <Button variant="secondary" onClick={reset}>
            {t('listening:feedback.composer.receipt.another')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-6">
      {apiError ? <Alert tone="danger">{apiError}</Alert> : null}
      {errors.length > 0 ? <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} /> : null}

      <RadioGroup label={t('listening:feedback.composer.kind')} value={kind} onValueChange={(v) => setKind(v as FeedbackCaseKind)}>
        <RadioItem value="problem">{t('listening:feedback.kind.problem')}</RadioItem>
        <RadioItem value="suggestion">{t('listening:feedback.kind.suggestion')}</RadioItem>
      </RadioGroup>

      {routes.length > 1 ? (
        <Field label={t('listening:feedback.composer.route')} id={ids.route}>
          <Select
            options={routes.map((r) => ({ value: r.id, label: t(`listening:feedback.composer.route_${r.kind}`) }))}
            value={routeId}
            onValueChange={(v) => {
              if (!v) return;
              setRouteId(v);
              setCategory('');
            }}
          />
        </Field>
      ) : null}
      {route.kind === 'sensitive' ? (
        <Alert tone="info">{t('listening:feedback.composer.sensitiveNote', { hours: route.operatingHours ?? t('listening:feedback.composer.hoursUnknown') })}</Alert>
      ) : null}

      <Field label={t('listening:feedback.composer.category')} id={ids.category} error={errors.find((e) => e.id === ids.category)?.message} required>
        <Select options={categoryOptions} value={category} placeholder={t('listening:feedback.composer.categoryPlaceholder')} onValueChange={(v) => setCategory(v ?? '')} />
      </Field>

      <RadioGroup label={t('listening:feedback.composer.recipient')} value={choice} onValueChange={(v) => setChoice(v as FeedbackRouteChoice)}>
        <RadioItem value="primary">{t('listening:feedback.composer.primaryOption', { name: route.primary.displayName })}</RadioItem>
        <RadioItem value="alternate">{t('listening:feedback.composer.alternateOption', { name: route.alternate.displayName })}</RadioItem>
      </RadioGroup>
      <Card tone="subtle" padding="md" role="status" aria-live="polite" data-testid="recipient-preview">
        <Text>{t('listening:feedback.composer.preview', { name: recipient.displayName, function: t(functionKey(choice)) })}</Text>
        <Text tone="secondary" typeRole="metadata">
          {choice === 'alternate'
            ? t('listening:feedback.composer.previewAlternate', { other: other.displayName })
            : t('listening:feedback.composer.previewPrimary', { other: other.displayName })}
        </Text>
      </Card>

      <div className="space-y-2">
        <Switch checked={anonymous} onCheckedChange={setAnonymous}>
          {t('listening:feedback.composer.anonymous')}
        </Switch>
        <Text tone="secondary" typeRole="metadata">
          {anonymous ? t('listening:feedback.composer.anonymousHint') : t('listening:feedback.composer.anonymousOff')}
        </Text>
        <Alert tone="warning">{t('listening:feedback.composer.identityWarning')}</Alert>
      </div>

      <Field label={t('listening:feedback.composer.body')} id={ids.body} description={t('listening:feedback.composer.bodyHint')} error={errors.find((e) => e.id === ids.body)?.message} required>
        <Textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, FEEDBACK_BODY_MAX))} rows={6} />
      </Field>

      <PrivacyAtPointOfUse question={t('common:privacy.whoCanSee')} explanation={t('listening:feedback.composer.whoSees')} />

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t('listening:feedback.composer.sending') : t('listening:feedback.composer.submit')}
        </Button>
        <Link to="/feedback" className={buttonClassNames({ variant: 'secondary' })}>
          {t('common:action.cancel')}
        </Link>
      </div>
    </form>
  );
}
