import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDialog, AlertDialogContent, Badge, Button, Card, DataList, Field, Heading, Skeleton, Text, Textarea, buttonClassNames, useToast } from '@nestself/ui';
import { ACTIVE_REVIEW_REQUEST_STATUSES, can, type ReviewRequestResponse, type ReviewScopeView } from '@nestself/contracts';
import { formatDate, formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { useOrgContext } from '../people/use-org-context';
import { REQUEST_TONE, SCOPE_TONE, priceLabel, requestStatusKey, scopeLabel, scopeStatusKey } from './review-labels';
import { sampleReviewRequest } from './sample-reviews';
import { useAcceptScope, useAnswerInformation, useCancelReviewRequest, useRejectScope, useReviewRequest } from './use-reviews';

export interface RequestScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  requestId: string;
}

/**
 * One review request (spec REV-02, REV-03, REV-05): status and coordinator,
 * the information NestSelf asked for, the versioned scopes with their price
 * and terms, and the approver's accept or decline behind the financial
 * step-up. Accepting opens the engagement; nothing is paid here.
 */
export function RequestScreen({ listeningApi, sampleMode, requestId }: RequestScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const navigate = useNavigate();
  const { principal, effectiveActions } = useAuth();
  const { orgId, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useReviewRequest(listeningApi, apiOrgId, requestId);
  const accept = useAcceptScope(listeningApi, orgId ?? '', requestId);
  const reject = useRejectScope(listeningApi, orgId ?? '', requestId);
  const cancel = useCancelReviewRequest(listeningApi, orgId ?? '', requestId);
  const answer = useAnswerInformation(listeningApi, orgId ?? '', requestId);
  const [acceptTarget, setAcceptTarget] = useState<ReviewScopeView | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data: ReviewRequestResponse | undefined = sampleMode ? sampleReviewRequest(requestId) : query.data;
  const allowed = (action: string) => sampleMode || (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canAccept = allowed('workplace_reviews.scope.accept');
  const canRequest = allowed('workplace_reviews.request');

  const back = (
    <Link to="/listening/reviews" className="type-label text-primary underline">
      {t('listening:reviews.detail.back')}
    </Link>
  );
  if (!sampleMode && (switchError || query.isError)) {
    return (
      <div className="space-y-6">
        {back}
        <Alert tone="danger">{t(listeningErrorMessageKey(query.error) ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton lines={8} label={t('common:state.loading')} />
      </div>
    );
  }

  const fail = (err: unknown) => {
    const key = listeningErrorMessageKey(err);
    if (key) setError(t(key));
  };

  const onAccept = async () => {
    if (!acceptTarget) return;
    setError(null);
    if (sampleMode) {
      setAcceptTarget(null);
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      const engagement = await accept.mutateAsync(acceptTarget.id);
      setAcceptTarget(null);
      void navigate({ to: '/listening/reviews/engagements/$engagementId', params: { engagementId: engagement.id } });
    } catch (err) {
      setAcceptTarget(null);
      fail(err);
    }
  };

  const onReject = async (scope: ReviewScopeView) => {
    setError(null);
    if (sampleMode) {
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await reject.mutateAsync(scope.id);
    } catch (err) {
      fail(err);
    }
  };

  const onCancel = async () => {
    setError(null);
    if (sampleMode) {
      setCancelOpen(false);
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await cancel.mutateAsync({});
      setCancelOpen(false);
    } catch (err) {
      setCancelOpen(false);
      fail(err);
    }
  };

  const onAnswer = async (event: FormEvent) => {
    event.preventDefault();
    if (!answerText.trim()) return;
    setError(null);
    if (sampleMode) {
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await answer.mutateAsync({ answer: answerText.trim() });
      setAnswerText('');
    } catch (err) {
      fail(err);
    }
  };

  const active = ACTIVE_REVIEW_REQUEST_STATUSES.includes(data.status);
  return (
    <div className="space-y-8">
      {back}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level={1}>{t('listening:reviews.detail.title')}</Heading>
          <Badge tone={REQUEST_TONE[data.status]}>{t(requestStatusKey(data.status))}</Badge>
        </div>
        <Text tone="secondary">
          {scopeLabel(t, data.scopeCohortKey)} · {data.dimensionKeys.map((k) => t(`listening:dimensions.${k}.title`)).join(', ')}
        </Text>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:reviews.detail.requested', { date: formatDate(data.createdAt, locale) })} ·{' '}
          {data.coordinatorFirstName ? t('listening:reviews.detail.coordinator', { name: data.coordinatorFirstName }) : t('listening:reviews.detail.noCoordinator')}
        </Text>
      </div>
      {sampleMode ? <Alert tone="info">{t('listening:reviews.sampleNote')}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {data.status === 'canceled' ? <Alert tone="info">{t('listening:reviews.detail.canceled')}</Alert> : null}
      {data.status === 'declined' && data.declineReason ? <Alert tone="warning">{t('listening:reviews.detail.declined', { reason: data.declineReason })}</Alert> : null}

      {data.context ? (
        <Card padding="md" tone="subtle" className="space-y-1">
          <Text typeRole="label">{t('listening:reviews.detail.context')}</Text>
          <Text className="whitespace-pre-line">{data.context}</Text>
        </Card>
      ) : null}

      {data.status === 'needs_information' && data.informationRequest ? (
        <form onSubmit={(e) => void onAnswer(e)} noValidate className="space-y-3 rounded-card border border-border-subtle p-4">
          <Text typeRole="label">{t('listening:reviews.detail.informationNeeded')}</Text>
          <Text className="whitespace-pre-line">{data.informationRequest}</Text>
          <Field label={t('listening:reviews.detail.answer')} id="request-answer" required>
            <Textarea value={answerText} onChange={(e) => setAnswerText(e.target.value)} rows={4} />
          </Field>
          <Button variant="primary" type="submit" disabled={!answerText.trim() || answer.isPending}>
            {t('listening:reviews.detail.answerSubmit')}
          </Button>
        </form>
      ) : null}
      {data.informationAnswer ? (
        <Card padding="md" tone="subtle" className="space-y-1">
          <Text typeRole="label">{t('listening:reviews.detail.answered')}</Text>
          <Text className="whitespace-pre-line">{data.informationAnswer}</Text>
        </Card>
      ) : null}

      <section aria-labelledby="request-scopes" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="request-scopes">
          {t('listening:reviews.detail.scopes')}
        </Heading>
        {data.scopes.length === 0 ? <Text tone="secondary">{t('listening:reviews.detail.noScopes')}</Text> : null}
        {[...data.scopes].reverse().map((scope) => (
          <Card key={scope.id} as="article" padding="lg" className="space-y-3" aria-label={`${t('listening:reviews.detail.scope.version', { version: scope.version })}: ${scope.title}`}>
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
                ...(scope.taxNote ? [{ term: t('listening:reviews.detail.scope.tax'), description: scope.taxNote }] : []),
                { term: t('listening:reviews.detail.scope.cancellation'), description: scope.cancellationPolicy },
                { term: t('listening:reviews.detail.scope.terms', { version: scope.termsVersion }), description: t('listening:reviews.detail.scope.validUntil', { date: formatDateTime(scope.validUntil, locale) }) },
              ]}
            />
            {scope.acceptedAt ? (
              <Text tone="secondary" typeRole="metadata">
                {t('listening:reviews.detail.scope.accepted', { date: formatDateTime(scope.acceptedAt, locale) })}
              </Text>
            ) : null}
            {scope.status === 'sent' ? (
              canAccept ? (
                <div className="flex flex-wrap items-center gap-3">
                  {scope.priceMinor === null ? (
                    <Text tone="secondary" typeRole="metadata">
                      {t('listening:errors.scope_unpriced')}
                    </Text>
                  ) : (
                    <Button variant="primary" onClick={() => setAcceptTarget(scope)} disabled={accept.isPending}>
                      {t('listening:reviews.detail.scope.accept')}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => void onReject(scope)} disabled={reject.isPending}>
                    {t('listening:reviews.detail.scope.reject')}
                  </Button>
                </div>
              ) : (
                <Text tone="secondary" typeRole="metadata">
                  {t('listening:reviews.detail.scope.noAuthority')}
                </Text>
              )
            ) : null}
          </Card>
        ))}
      </section>

      {data.engagementId ? (
        <Card padding="md" tone="brand" className="flex flex-wrap items-center justify-between gap-3">
          <Text>{t('listening:reviews.detail.engagement')}</Text>
          <Link to="/listening/reviews/engagements/$engagementId" params={{ engagementId: data.engagementId }} className={buttonClassNames({ variant: 'primary' })}>
            {t('listening:reviews.detail.viewEngagement')}
          </Link>
        </Card>
      ) : null}

      {active && canRequest ? (
        <div>
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            {t('listening:reviews.detail.cancel')}
          </Button>
        </div>
      ) : null}

      <AlertDialog open={acceptTarget !== null} onOpenChange={(open) => !open && !accept.isPending && setAcceptTarget(null)}>
        <AlertDialogContent
          title={t('listening:reviews.detail.scope.acceptTitle')}
          description={t('listening:reviews.detail.scope.acceptBody')}
          confirmLabel={t('listening:reviews.detail.scope.acceptConfirm')}
          cancelLabel={t('common:action.cancel')}
          onConfirm={() => void onAccept()}
          confirmPending={accept.isPending}
        />
      </AlertDialog>
      <AlertDialog open={cancelOpen} onOpenChange={(open) => !open && !cancel.isPending && setCancelOpen(false)}>
        <AlertDialogContent
          title={t('listening:reviews.detail.cancelTitle')}
          description={t('listening:reviews.detail.cancelBody')}
          confirmLabel={t('listening:reviews.detail.cancelConfirm')}
          cancelLabel={t('common:action.cancel')}
          destructive
          onConfirm={() => void onCancel()}
          confirmPending={cancel.isPending}
        />
      </AlertDialog>
    </div>
  );
}
