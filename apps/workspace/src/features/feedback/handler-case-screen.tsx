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
  Field,
  FormErrorSummary,
  Heading,
  Input,
  Select,
  Skeleton,
  Switch,
  Text,
  Textarea,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { FEEDBACK_TRANSITIONS, type FeedbackCaseState, type FeedbackMessageView, type HandlerFeedbackCaseResponse } from '@nestself/contracts';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { useOrgContext } from '../people/use-org-context';
import { STATE_TONE, categoryLabel, functionKey, handlerStateKey, kindKey, otherChoice } from './case-labels';
import { sampleHandlerFeedbackCase } from './sample-feedback';
import { useHandlerCase, useHandlerMessage, useReassignCase, useSetCaseState } from './use-feedback';

export interface HandlerCaseScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  caseId: string;
}

/**
 * The handler's case (spec FBK-02, FBK-04): the thread with internal notes
 * visibly set apart from what the reporter reads, a message form with an
 * internal-note switch, the state controls of the state machine (resolving
 * asks for the reporter-facing explanation, closing for the outcome reason)
 * and the hand-over to the route's other recipient behind a confirmation.
 */
export function HandlerCaseScreen({ listeningApi, sampleMode, caseId }: HandlerCaseScreenProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { orgId, switchError } = useOrgContext(sampleMode);
  const query = useHandlerCase(listeningApi, sampleMode || orgId === null ? null : caseId);
  const [sampleCase, setSampleCase] = useState<HandlerFeedbackCaseResponse | null>(null);
  const data = sampleMode ? (sampleCase ?? sampleHandlerFeedbackCase(caseId)) : query.data;

  const back = (
    <Link to="/feedback/inbox" className="type-label text-primary underline">
      {t('listening:feedback.handler.back')}
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
        <Skeleton lines={8} label={t('common:state.loading')} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {back}
      <CaseDetail key={data.id} listeningApi={listeningApi} sampleMode={sampleMode} data={data} onSample={setSampleCase} />
    </div>
  );
}

interface CaseDetailProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  data: HandlerFeedbackCaseResponse;
  onSample: (next: HandlerFeedbackCaseResponse) => void;
}

function CaseDetail({ listeningApi, sampleMode, data, onSample }: CaseDetailProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const idPrefix = useId();
  const message = useHandlerMessage(listeningApi, data.id);
  const setState = useSetCaseState(listeningApi, data.id);
  const reassign = useReassignCase(listeningApi, data.id);

  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [nextState, setNextState] = useState<FeedbackCaseState | ''>('');
  const [nextAction, setNextAction] = useState('');
  const [explanation, setExplanation] = useState('');
  const [outcomeReason, setOutcomeReason] = useState('');
  const [stateErrors, setStateErrors] = useState<FormError[]>([]);
  const [stateError, setStateError] = useState<string | null>(null);
  const [confirmHandover, setConfirmHandover] = useState(false);

  const allowed = FEEDBACK_TRANSITIONS[data.state];
  const closed = data.state === 'closed';
  const ids = { body: `${idPrefix}-body`, state: `${idPrefix}-state`, explanation: `${idPrefix}-explanation`, outcome: `${idPrefix}-outcome`, nextAction: `${idPrefix}-next-action` };
  const other = otherChoice(data.routeChoice);
  const errorText = (err: unknown) => {
    const key = listeningErrorMessageKey(err);
    return key ? t(key) : null;
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    setMessageError(null);
    if (!text) {
      setMessageError(t('listening:feedback.handler.errors.bodyRequired'));
      return;
    }
    if (sampleMode) {
      onSample({ ...data, messages: [...data.messages, { id: `sample_${Date.now()}`, sender: 'handler', body: text, createdAt: new Date().toISOString(), internal }] });
      setBody('');
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await message.mutateAsync({ body: { body: text, internal }, idempotencyKey: crypto.randomUUID() });
      setBody('');
      addToast({ title: t(internal ? 'listening:feedback.handler.noteSaved' : 'listening:feedback.handler.sent'), tone: 'success' });
    } catch (err) {
      const text = errorText(err);
      if (text) setMessageError(text);
    }
  };

  const applyState = async (event: FormEvent) => {
    event.preventDefault();
    const problems: FormError[] = [];
    if (!nextState) problems.push({ id: ids.state, label: t('listening:feedback.handler.newState'), message: t('listening:feedback.handler.errors.stateRequired') });
    if (nextState === 'resolved' && !explanation.trim()) {
      problems.push({ id: ids.explanation, label: t('listening:feedback.handler.explanation'), message: t('listening:feedback.handler.errors.explanationRequired') });
    }
    if (nextState === 'closed' && !outcomeReason.trim()) {
      problems.push({ id: ids.outcome, label: t('listening:feedback.handler.outcomeReason'), message: t('listening:feedback.handler.errors.outcomeRequired') });
    }
    setStateErrors(problems);
    setStateError(null);
    if (problems.length > 0 || !nextState) return;
    const request = {
      state: nextState,
      ...(nextAction.trim() ? { nextAction: nextAction.trim() } : {}),
      ...(nextState === 'resolved' ? { reporterExplanation: explanation.trim() } : {}),
      ...(nextState === 'closed' ? { outcomeReason: outcomeReason.trim() } : {}),
    };
    if (sampleMode) {
      onSample({
        ...data,
        state: nextState,
        nextAction: request.nextAction ?? null,
        messages: request.reporterExplanation
          ? [...data.messages, { id: `sample_${Date.now()}`, sender: 'handler', body: request.reporterExplanation, createdAt: new Date().toISOString(), internal: false }]
          : data.messages,
      });
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      const next = await setState.mutateAsync(request);
      setNextState('');
      setNextAction('');
      setExplanation('');
      setOutcomeReason('');
      addToast({ title: t('listening:feedback.handler.stateChanged', { state: t(handlerStateKey(next.state)) }), tone: 'success' });
    } catch (err) {
      const text = errorText(err);
      if (text) setStateError(text);
    }
  };

  const handOver = async () => {
    if (sampleMode) {
      setConfirmHandover(false);
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await reassign.mutateAsync({ to: other });
      setConfirmHandover(false);
      addToast({ title: t('listening:feedback.handler.reassigned'), tone: 'success' });
    } catch (err) {
      const text = errorText(err);
      if (text) {
        setStateError(text);
        setConfirmHandover(false);
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level={1}>{t('listening:feedback.handler.title', { pseudonym: data.pseudonym })}</Heading>
          <Badge tone={STATE_TONE[data.state]}>{t(handlerStateKey(data.state))}</Badge>
          {data.escalatedAt ? <Badge tone="warning">{t('listening:feedback.inbox.escalated')}</Badge> : null}
        </div>
        <Text tone="secondary">
          {t(kindKey(data.kind))} · {categoryLabel(t, data.category)} · {t(`listening:feedback.composer.route_${data.routeKind}`)} · {t(functionKey(data.routeChoice))}
        </Text>
        <Text tone="secondary" typeRole="metadata">
          {data.nextAction ? `${t('listening:feedback.columns.nextAction')}: ${t(`listening:feedback.nextAction.${data.nextAction}`, { defaultValue: data.nextAction })}` : null}
          {data.dueAt ? ` · ${t('listening:feedback.case.due', { date: formatDateTime(data.dueAt, locale) })}` : null}
        </Text>
        {data.anonymousToEmployer ? (
          <Text tone="secondary" typeRole="metadata">
            {t('listening:feedback.handler.anonymous')}
          </Text>
        ) : null}
      </div>
      {sampleMode ? <Alert tone="info">{t('listening:feedback.inbox.sampleNote')}</Alert> : null}
      {stateError ? <Alert tone="danger">{stateError}</Alert> : null}

      <section aria-labelledby={`${idPrefix}-thread`} className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-thread`}>
          {t('listening:feedback.handler.thread')}
        </Heading>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:feedback.handler.internalHint')}
        </Text>
        <ol className="space-y-3">
          {data.messages.map((m) => (
            <ThreadItem key={m.id} message={m} locale={locale} />
          ))}
        </ol>
      </section>

      {closed ? (
        <Alert tone="info">{t('listening:feedback.handler.closedNote')}</Alert>
      ) : (
        <>
          <form onSubmit={(e) => void sendMessage(e)} noValidate className="space-y-3" aria-labelledby={`${idPrefix}-message-title`}>
            <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-message-title`}>
              {t('listening:feedback.handler.message')}
            </Heading>
            {messageError ? <Alert tone="danger">{messageError}</Alert> : null}
            <Field label={t('listening:feedback.handler.message')} id={ids.body} required>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={t('listening:feedback.handler.messagePlaceholder')} />
            </Field>
            <Switch checked={internal} onCheckedChange={setInternal}>
              {t('listening:feedback.handler.asInternal')}
            </Switch>
            <Button variant={internal ? 'secondary' : 'primary'} type="submit" disabled={message.isPending}>
              {internal ? t('listening:feedback.handler.sendInternal') : t('listening:feedback.handler.sendVisible')}
            </Button>
          </form>

          <form onSubmit={(e) => void applyState(e)} noValidate className="space-y-3" aria-labelledby={`${idPrefix}-state-title`}>
            <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-state-title`}>
              {t('listening:feedback.handler.changeState')}
            </Heading>
            {stateErrors.length > 0 ? <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={stateErrors} /> : null}
            <Field label={t('listening:feedback.handler.newState')} id={ids.state} error={stateErrors.find((e) => e.id === ids.state)?.message} required>
              <Select
                options={allowed.map((s) => ({ value: s, label: t(handlerStateKey(s)) }))}
                value={nextState}
                placeholder={t('listening:feedback.handler.statePlaceholder')}
                onValueChange={(v) => setNextState((v as FeedbackCaseState) ?? '')}
              />
            </Field>
            <Field label={t('listening:feedback.handler.nextAction')} id={ids.nextAction}>
              <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} maxLength={200} />
            </Field>
            {nextState === 'resolved' ? (
              <Field
                label={t('listening:feedback.handler.explanation')}
                id={ids.explanation}
                description={t('listening:feedback.handler.explanationHint')}
                error={stateErrors.find((e) => e.id === ids.explanation)?.message}
                required
              >
                <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} />
              </Field>
            ) : null}
            {nextState === 'closed' ? (
              <Field
                label={t('listening:feedback.handler.outcomeReason')}
                id={ids.outcome}
                description={t('listening:feedback.handler.outcomeReasonHint')}
                error={stateErrors.find((e) => e.id === ids.outcome)?.message}
                required
              >
                <Input value={outcomeReason} onChange={(e) => setOutcomeReason(e.target.value)} maxLength={500} />
              </Field>
            ) : null}
            <Button variant="primary" type="submit" disabled={setState.isPending}>
              {t('listening:feedback.handler.apply')}
            </Button>
          </form>

          <Card tone="subtle" padding="md" className="flex flex-wrap items-center justify-between gap-3">
            <Text>{t('listening:feedback.handler.reassignLead', { function: t(functionKey(other)) })}</Text>
            <Button variant="secondary" onClick={() => setConfirmHandover(true)} disabled={reassign.isPending}>
              {t('listening:feedback.handler.reassign', { function: t(functionKey(other)) })}
            </Button>
          </Card>
        </>
      )}

      <AlertDialog open={confirmHandover} onOpenChange={(open) => !open && !reassign.isPending && setConfirmHandover(false)}>
        <AlertDialogContent
          title={t('listening:feedback.handler.reassignTitle')}
          description={t('listening:feedback.handler.reassignBody', { function: t(functionKey(other)) })}
          confirmLabel={t('listening:feedback.handler.reassignConfirm')}
          cancelLabel={t('common:action.cancel')}
          onConfirm={() => void handOver()}
          confirmPending={reassign.isPending}
        />
      </AlertDialog>
    </div>
  );
}

function ThreadItem({ message, locale }: { message: FeedbackMessageView; locale: Locale }) {
  const { t } = useTranslation(['listening']);
  const senderKey = message.sender === 'reporter' ? 'reporter' : message.sender === 'handler' ? 'handler' : 'system';
  return (
    <li
      className={
        message.internal
          ? 'rounded-card border border-dashed border-border-control bg-canvas p-4'
          : message.sender === 'reporter'
            ? 'rounded-card border border-border-subtle bg-surface p-4'
            : 'rounded-card border border-border-subtle bg-accent-soft p-4'
      }
      data-internal={message.internal ? 'true' : undefined}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="type-label text-text">{t(`listening:feedback.handler.${senderKey}`)}</span>
        {message.internal ? <Badge tone="neutral">{t('listening:feedback.handler.internalNote')}</Badge> : null}
        <span className="type-metadata text-text-secondary">{formatDateTime(message.createdAt, locale)}</span>
      </div>
      <Text className="whitespace-pre-line">{message.body}</Text>
    </li>
  );
}
