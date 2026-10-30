/**
 * One chat message as everyone sees it, and one message as the moderator
 * reviews it (publish, edit then publish, answer, dismiss; WBN-23, WBN-24).
 * Shared by `ChatPanel` and `ModeratorQueue`.
 */
import { ArrowBendDownRight, Check, PencilSimple, Prohibit } from '@phosphor-icons/react/dist/ssr';
import { WEBINAR_ANSWER_TEXT_MAX_LENGTH, WEBINAR_MESSAGE_TEXT_MAX_LENGTH } from '@nestself/contracts';
import type { WebinarMessage, WebinarModerationMessage } from '@nestself/contracts';
import { AnimatePresence, Badge, Button, cn, m, useMotionPreset } from '@nestself/ui';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortTime } from './WebinarStageHooks';

/** A plain, token-styled text area (the `@nestself/ui` one is uncontrolled). */
export const TEXTAREA_CLASS =
  'min-h-24 px-3 py-2 w-full resize-y rounded-control border border-border-control bg-surface text-text type-body placeholder:text-text-secondary aria-invalid:border-2 aria-invalid:border-danger focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus';

function authorLine(message: WebinarMessage, t: (key: string) => string): string {
  if (message.kind === 'host') return message.authorFirstName ?? t('webinar.chat.host');
  return message.authorFirstName ?? t('webinar.chat.participant');
}

export interface ChatMessageItemProps {
  message: WebinarMessage;
  /** Moderator view: show the status of a message that is not public. */
  showStatus?: boolean;
}

/** A published or answered message: author (first name only if attached), question badge, text and the hosts' answer. */
export function ChatMessageItem({ message, showStatus = false }: ChatMessageItemProps) {
  const { t } = useTranslation('calls');
  const time = useShortTime();
  return (
    <article
      data-testid="webinar-chat-message"
      data-status={message.status}
      data-kind={message.kind}
      className={cn('gap-1 py-2 flex flex-col', message.status === 'dismissed' && 'text-text-secondary')}
    >
      <p className="gap-2 flex flex-wrap items-center type-metadata text-text-secondary">
        <span className="font-[var(--font-weight-label)] text-text">{authorLine(message, t)}</span>
        {message.kind === 'host' ? <Badge tone="info">{t('webinar.chat.host')}</Badge> : null}
        {message.kind === 'question' ? <Badge>{t('webinar.chat.question')}</Badge> : null}
        {showStatus && message.status !== 'published' ? <Badge tone="warning">{t(`webinar.chat.status.${message.status}`)}</Badge> : null}
        <time dateTime={message.publishedAt ?? message.createdAt}>{time(message.publishedAt ?? message.createdAt)}</time>
      </p>
      <p className="type-body break-words whitespace-pre-wrap">{message.text}</p>
      {message.answerText ? (
        <div className="mt-1 pl-3 border-l-2 border-primary">
          <p className="type-metadata font-[var(--font-weight-label)] text-text-secondary">{t('webinar.chat.answerLabel')}</p>
          <p className="type-body break-words whitespace-pre-wrap">{message.answerText}</p>
        </div>
      ) : null}
    </article>
  );
}

export interface ModerationMessageCardProps {
  message: WebinarModerationMessage;
  /** Which action on this message is in flight. */
  busy: 'publish' | 'answer' | 'dismiss' | null;
  onPublish: (text?: string) => Promise<void>;
  onAnswer: (answerText: string) => Promise<void>;
  onDismiss: () => Promise<void>;
}

type Mode = 'idle' | 'edit' | 'answer';

/**
 * A pending message for the moderator: kind, the registration name even for
 * an anonymous message (operational follow-up, WBN-23), whether the audience
 * will see the first name, and the review actions. Edit and answer open
 * inline forms that animate as disclosures; a failed action keeps the text.
 */
export function ModerationMessageCard({ message, busy, onPublish, onAnswer, onDismiss }: ModerationMessageCardProps) {
  const { t } = useTranslation('calls');
  const time = useShortTime();
  const disclosure = useMotionPreset('disclosure');
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState(message.text);
  const [answer, setAnswer] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const formId = useId();
  const errorId = `${formId}-error`;

  const change = (next: Mode) => {
    setMode(next);
    setFieldError(null);
    if (next === 'edit') setDraft(message.text);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = (mode === 'edit' ? draft : answer).trim();
    const max = mode === 'edit' ? WEBINAR_MESSAGE_TEXT_MAX_LENGTH : WEBINAR_ANSWER_TEXT_MAX_LENGTH;
    if (!value) return setFieldError(t('webinar.chat.required'));
    if (value.length > max) return setFieldError(t('webinar.chat.tooLong', { max }));
    setFieldError(null);
    const action = mode === 'edit' ? onPublish(value === message.text ? undefined : value) : onAnswer(value);
    void action.then(() => setMode('idle')).catch(() => undefined);
  };

  return (
    <article
      data-testid="webinar-moderation-message"
      data-message-id={message.id}
      className="gap-2 p-3 flex flex-col rounded-card border border-border-subtle bg-surface"
    >
      <p className="gap-2 flex flex-wrap items-center type-metadata text-text-secondary">
        <Badge>{message.kind === 'question' ? t('webinar.chat.question') : t('webinar.chat.kindMessage')}</Badge>
        <span className="font-[var(--font-weight-label)] text-text">{t('webinar.chat.from', { name: message.authorName ?? t('webinar.chat.participant') })}</span>
        <span>{message.showFirstName ? t('webinar.chat.showsFirstName') : t('webinar.chat.anonymousToAudience')}</span>
        <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
      </p>
      <p className="type-body break-words whitespace-pre-wrap">{message.text}</p>

      <div className="gap-2 flex flex-wrap" role="group" aria-label={t('webinar.moderation.title')}>
        <Button size="sm" leadingIcon={<Check size={18} />} loading={busy === 'publish'} loadingLabel={t('webinar.chat.sending')} onClick={() => void onPublish().catch(() => undefined)}>
          {t('webinar.moderation.publish')}
        </Button>
        <Button size="sm" variant="secondary" leadingIcon={<PencilSimple size={18} />} aria-expanded={mode === 'edit'} onClick={() => change(mode === 'edit' ? 'idle' : 'edit')}>
          {t('webinar.moderation.edit')}
        </Button>
        <Button size="sm" variant="secondary" leadingIcon={<ArrowBendDownRight size={18} />} aria-expanded={mode === 'answer'} onClick={() => change(mode === 'answer' ? 'idle' : 'answer')}>
          {t('webinar.moderation.answer')}
        </Button>
        <Button size="sm" variant="ghost" leadingIcon={<Prohibit size={18} />} loading={busy === 'dismiss'} loadingLabel={t('webinar.chat.sending')} onClick={() => void onDismiss().catch(() => undefined)}>
          {t('webinar.moderation.dismiss')}
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {mode !== 'idle' ? (
          <m.div key={mode} {...disclosure} className="overflow-hidden" data-testid={mode === 'edit' ? 'webinar-edit-form' : 'webinar-answer-form'}>
            <form onSubmit={submit} className="gap-2 pt-1 flex flex-col" noValidate>
              <label htmlFor={formId} className="type-label">
                {mode === 'edit' ? t('webinar.moderation.editLabel') : t('webinar.moderation.answerLabel')}
              </label>
              <textarea
                id={formId}
                rows={3}
                value={mode === 'edit' ? draft : answer}
                onChange={(event) => (mode === 'edit' ? setDraft(event.target.value) : setAnswer(event.target.value))}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? errorId : undefined}
                className={TEXTAREA_CLASS}
              />
              {fieldError ? (
                <p id={errorId} className="type-metadata text-danger">
                  {fieldError}
                </p>
              ) : null}
              <div className="gap-2 flex flex-wrap">
                <Button type="submit" size="sm" loading={busy === (mode === 'edit' ? 'publish' : 'answer')} loadingLabel={t('webinar.chat.sending')}>
                  {mode === 'edit' ? t('webinar.moderation.publishEdited') : t('webinar.moderation.sendAnswer')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => change('idle')}>
                  {t('webinar.moderation.cancel')}
                </Button>
              </div>
            </form>
          </m.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}
