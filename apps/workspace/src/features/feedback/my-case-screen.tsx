import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, ChatComposer, ChatThread, Heading, Skeleton, Text, useToast } from '@nestself/ui';
import type { ChatMessage } from '@nestself/ui';
import type { MyFeedbackCaseResponse } from '@nestself/contracts';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { STATE_TONE, categoryLabel, functionKey, kindKey, reporterStateKey } from './case-labels';
import { sampleMyFeedbackCase } from './sample-feedback';
import { useMyFeedbackCase, useReplyToMyCase } from './use-feedback';

export interface MyCaseScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  caseId: string;
}

/**
 * The reporter's case (spec FBK-02, FBK-04): the visible thread (internal
 * notes never reach this screen), the function handling it, and a composer
 * for replies and clarification requests. A reply on a resolved case reopens
 * it; a closed case accepts none.
 */
export function MyCaseScreen({ listeningApi, sampleMode, caseId }: MyCaseScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const query = useMyFeedbackCase(listeningApi, sampleMode ? null : caseId);
  const reply = useReplyToMyCase(listeningApi, caseId);
  const [draft, setDraft] = useState('');
  const [draftState, setDraftState] = useState<'idle' | 'sending' | 'failed'>('idle');
  const [sampleCase, setSampleCase] = useState<MyFeedbackCaseResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const data = sampleMode ? (sampleCase ?? sampleMyFeedbackCase(caseId)) : query.data;

  const back = (
    <Link to="/feedback" className="type-label text-primary underline">
      {t('listening:feedback.case.back')}
    </Link>
  );

  if (!sampleMode && query.isError) {
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
        <Skeleton lines={6} label={t('common:state.loading')} />
      </div>
    );
  }

  const messages: ChatMessage[] = data.messages.map((m) => ({ id: m.id, author: m.sender === 'reporter' ? 'me' : 'them', text: m.body }));
  const closed = data.state === 'closed';

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraftState('sending');
    setSendError(null);
    if (sampleMode) {
      setSampleCase({
        ...data,
        state: data.state === 'resolved' ? 'in_review' : data.state,
        messages: [...data.messages, { id: `sample_${Date.now()}`, sender: 'reporter', body: text, createdAt: new Date().toISOString(), internal: false }],
      });
      setDraft('');
      setDraftState('idle');
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await reply.mutateAsync({ body: { body: text }, idempotencyKey: crypto.randomUUID() });
      setDraft('');
      setDraftState('idle');
    } catch (err) {
      setDraftState('failed');
      const key = listeningErrorMessageKey(err);
      setSendError(key ? t(key) : t('listening:errors.unknown'));
    }
  };

  return (
    <div className="space-y-6">
      {back}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level={1}>{t('listening:feedback.case.title', { pseudonym: data.pseudonym })}</Heading>
          <Badge tone={STATE_TONE[data.state]}>{t(reporterStateKey(data.state))}</Badge>
        </div>
        <Text tone="secondary">
          {t(kindKey(data.kind))} · {categoryLabel(t, data.category)} · {t('listening:feedback.case.handledBy', { function: t(functionKey(data.handlerFunction)) })}
        </Text>
        {data.dueAt ? (
          <Text tone="secondary" typeRole="metadata">
            {t('listening:feedback.case.due', { date: formatDateTime(data.dueAt, locale) })}
          </Text>
        ) : null}
      </div>
      {sampleMode ? <Alert tone="info">{t('listening:feedback.case.sampleNote')}</Alert> : null}
      <ChatThread messages={messages} labels={{ title: t('listening:feedback.case.thread') }} />
      {closed ? (
        <Alert tone="info">{t('listening:feedback.case.closed')}</Alert>
      ) : (
        <div className="space-y-2">
          {data.state === 'resolved' ? <Alert tone="info">{t('listening:feedback.case.resolvedNote')}</Alert> : null}
          {sendError ? <Alert tone="danger">{sendError}</Alert> : null}
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            draftState={draftState}
            labels={{
              message: t('listening:feedback.case.replyPlaceholder'),
              send: t('listening:feedback.case.send'),
              retry: t('common:action.retry'),
              failedNotice: t('listening:feedback.case.failed'),
              sentNotice: t('listening:feedback.case.sent'),
            }}
          />
        </div>
      )}
    </div>
  );
}
