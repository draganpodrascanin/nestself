/**
 * Read-only conversation views. The expert view (`/cases/$id`) reads through
 * the assigned-expert path, which may ask for step-up (restricted class),
 * and offers the case intake. The participant view (`/conversations/$id`)
 * reads the caller's own conversation. Bodies stay on this screen only: the
 * queries keep no cache after unmount and nothing is logged.
 */
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ProfessionalApi } from '@nestself/api-client';
import type { ConversationResponse } from '@nestself/contracts';
import { Alert, Button, Card, Field, Heading, Input, Text } from '@nestself/ui';
import { useAuth } from '../../auth';
import { casesErrorKey } from './cases-errors';
import type { CasesErrorKey } from './cases-errors';
import { ConversationMessages } from './conversation-messages';
import { sampleConversation, sampleIntake, sampleIntakeIdFor } from './sample-cases';
import { useExpertConversation, useIntake, useMyConversation } from './use-cases';
import { useExpertContext } from './use-expert-context';

export interface ConversationScreenProps {
  pro: ProfessionalApi;
  conversationId: string;
  sampleMode: boolean;
}

const linkClass =
  'text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus';

export function ExpertConversationScreen({ pro, conversationId, sampleMode }: ConversationScreenProps) {
  const { principal } = useAuth();
  const { ready, switchError } = useExpertContext(sampleMode);
  const enabled = !sampleMode && (ready || (principal !== null && principal.expert === null));
  const query = useExpertConversation(pro, conversationId, enabled);
  return (
    <ConversationBody
      view="expert"
      conversationId={conversationId}
      sampleMode={sampleMode}
      conversation={sampleMode ? sampleConversation(conversationId) : query.data}
      error={sampleMode ? null : switchError ? 'context' : query.isError ? casesErrorKey(query.error) : null}
      onRetry={() => void query.refetch()}
      extra={<IntakeSection pro={pro} conversationId={conversationId} sampleMode={sampleMode} />}
    />
  );
}

export function MyConversationScreen({ pro, conversationId, sampleMode }: ConversationScreenProps) {
  const { principal } = useAuth();
  const query = useMyConversation(pro, conversationId, !sampleMode);
  return (
    <ConversationBody
      view="participant"
      conversationId={conversationId}
      sampleMode={sampleMode}
      conversation={sampleMode ? sampleConversation(conversationId, principal?.userId ?? '') : query.data}
      error={sampleMode ? null : query.isError ? casesErrorKey(query.error) : null}
      onRetry={() => void query.refetch()}
      extra={null}
    />
  );
}

function ConversationBody({
  view,
  conversationId,
  sampleMode,
  conversation,
  error,
  onRetry,
  extra,
}: {
  view: 'expert' | 'participant';
  conversationId: string;
  sampleMode: boolean;
  /** `undefined` while loading; `null` when a sample conversation does not exist. */
  conversation: ConversationResponse | null | undefined;
  error: CasesErrorKey | 'context' | null;
  onRetry: () => void;
  extra: ReactNode;
}) {
  const { t } = useTranslation(['workspace', 'common']);
  const { principal } = useAuth();
  const ns = view === 'expert' ? 'cases' : 'conversations';

  const back =
    view === 'expert' ? (
      <Link to="/cases" className={linkClass}>
        {t('workspace:cases.back')}
      </Link>
    ) : (
      <Link to="/conversations" className={linkClass}>
        {t('workspace:conversations.back')}
      </Link>
    );

  let body;
  if (error === 'context') {
    body = (
      <Alert tone="danger" title={t('workspace:cases.errors.contextTitle')}>
        {t('workspace:cases.errors.context')}
      </Alert>
    );
  } else if (error === 'stepUpCancelled') {
    body = (
      <div className="space-y-3">
        <Alert tone="info" title={t('workspace:cases.errors.stepUpCancelledTitle')}>
          {t('workspace:cases.errors.stepUpCancelled')}
        </Alert>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('workspace:cases.retry')}
        </Button>
      </div>
    );
  } else if (error) {
    body = (
      <Alert tone="danger" title={t('workspace:cases.errors.readTitle')}>
        {t(`workspace:cases.errors.${error}`)}
      </Alert>
    );
  } else if (conversation === null) {
    body = (
      <Alert tone="danger" title={t('workspace:cases.errors.readTitle')}>
        {t('workspace:cases.errors.notFound')}
      </Alert>
    );
  } else if (conversation === undefined) {
    body = <Text tone="secondary">{t('workspace:cases.loading')}</Text>;
  } else {
    body = (
      <section aria-labelledby="conversation-messages-heading" className="space-y-3">
        <Heading level={2} id="conversation-messages-heading">
          {t('workspace:cases.messages.heading')}
        </Heading>
        <Text tone="secondary">{t('workspace:cases.messages.readOnly')}</Text>
        <ConversationMessages messages={conversation.messages} viewerUserId={principal?.userId ?? ''} />
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {back}
      <div className="space-y-2">
        <Heading level={1}>
          {conversation
            ? t(`workspace:${ns}.detailTitle`, { id: conversation.caseId })
            : t(`workspace:${ns}.detailTitleLoading`)}
        </Heading>
        <Text tone="secondary">{t('workspace:cases.conversationId', { id: conversationId })}</Text>
      </div>
      {sampleMode ? <Alert tone="info">{t('workspace:cases.sampleNote')}</Alert> : null}
      {body}
      {conversation && !error ? extra : null}
    </div>
  );
}

/**
 * The case intake, read on request through the assigned-expert path. The
 * conversation does not carry the intake id, so the expert enters it; in
 * sample mode it is filled in from the fixture.
 */
function IntakeSection({ pro, conversationId, sampleMode }: ConversationScreenProps) {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const inputId = useId();
  const [draft, setDraft] = useState(() => (sampleMode ? (sampleIntakeIdFor(conversationId) ?? '') : ''));
  const [requested, setRequested] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const query = useIntake(pro, sampleMode ? null : requested);

  const intake = sampleMode ? (requested ? sampleIntake(requested) : undefined) : requested ? query.data : undefined;
  const errorKey: CasesErrorKey | null = sampleMode
    ? requested && intake === null
      ? 'notFound'
      : null
    : query.isError
      ? casesErrorKey(query.error)
      : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = draft.trim();
    if (!id) {
      setFieldError(t('workspace:cases.intake.required'));
      return;
    }
    setFieldError(null);
    if (id === requested && !sampleMode) void query.refetch();
    setRequested(id);
  };

  return (
    <section aria-labelledby="intake-heading" className="space-y-3">
      <Heading level={2} id="intake-heading">
        {t('workspace:cases.intake.heading')}
      </Heading>
      <Text tone="secondary">{t('workspace:cases.intake.lead')}</Text>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <Field id={inputId} label={t('workspace:cases.intake.idLabel')} error={fieldError ?? undefined} required>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
        </Field>
        <Button type="submit" variant="secondary" loading={!sampleMode && requested !== null && query.isFetching}>
          {t('workspace:cases.intake.open')}
        </Button>
      </form>
      {errorKey ? (
        <Alert
          tone={errorKey === 'stepUpCancelled' ? 'info' : 'danger'}
          title={
            errorKey === 'stepUpCancelled'
              ? t('workspace:cases.errors.stepUpCancelledTitle')
              : t('workspace:cases.intake.errorTitle')
          }
        >
          {t(`workspace:cases.errors.${errorKey}`)}
        </Alert>
      ) : intake ? (
        <Card className="space-y-1">
          <p className="type-metadata text-text-secondary">
            {t('workspace:cases.intake.recorded', { when: formatDateTime(intake.createdAt, locale) })}
          </p>
          <p className="type-body text-text whitespace-pre-wrap">{intake.body}</p>
        </Card>
      ) : null}
    </section>
  );
}
