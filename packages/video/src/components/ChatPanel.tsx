import { ChatCircleText, PaperPlaneRight } from '@phosphor-icons/react/dist/ssr';
import { WEBINAR_MESSAGE_TEXT_MAX_LENGTH } from '@nestself/contracts';
import type { WebinarMessage, WebinarModerationMessage } from '@nestself/contracts';
import { AnimatePresence, Button, Checkbox, MotionFeatures, RadioGroup, RadioItem, cn, m, useMotionPreset } from '@nestself/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebinarStage } from '../hooks/useWebinarStage';
import type { UseWebinarStageResult } from '../hooks/useWebinarStage';
import type { WebinarClientApi } from '../webinar/types';
import { ChatMessageItem, ModerationMessageCard, TEXTAREA_CLASS } from './ChatPanelMessage';
import { Announcer, ErrorStack } from './WebinarStageParts';
import { useChangeAnnouncement, useErrorMessages } from './WebinarStageHooks';

export interface ChatPanelProps {
  /** The viewer's webinar client; its role picks the attendee, presenter or moderator view. */
  client: WebinarClientApi;
  /** A failure from outside (loading the messages), already translated. */
  error?: string | null;
  className?: string;
}

type FeedEntry = { kind: 'public'; message: WebinarMessage } | { kind: 'review'; message: WebinarModerationMessage };

/** Attendees and presenters see published and answered messages (WBN-20); the moderator sees every status (11.3). */
function feedOf(stage: UseWebinarStageResult): FeedEntry[] {
  if (!stage.isModerator) return stage.publicMessages.map((message) => ({ kind: 'public', message }));
  const reviewed = new Set(stage.moderationMessages.map((message) => message.id));
  const entries: FeedEntry[] = [
    ...stage.moderationMessages.map((message): FeedEntry =>
      message.status === 'pending' ? { kind: 'review', message } : { kind: 'public', message },
    ),
    ...stage.publicMessages.filter((message) => !reviewed.has(message.id)).map((message): FeedEntry => ({ kind: 'public', message })),
  ];
  return entries.sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt) || a.message.id.localeCompare(b.message.id));
}

function busyOf(stage: UseWebinarStageResult, messageId: string): 'publish' | 'answer' | 'dismiss' | null {
  if (stage.isPending('message.publish', messageId)) return 'publish';
  if (stage.isPending('message.answer', messageId)) return 'answer';
  if (stage.isPending('message.dismiss', messageId)) return 'dismiss';
  return null;
}

interface ComposerProps {
  stage: UseWebinarStageResult;
}

/** Text, counter and the inline field error shared by both composers. */
function useComposerText() {
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  return { text, setText, fieldError, setFieldError };
}

/** Space-separated element ids for `aria-describedby`. */
function ids(...values: Array<string | false | null>): string {
  return values.filter(Boolean).join(' ');
}

function submitOnModEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

/**
 * Attendees write to the hosts: a message or a question, anonymous unless
 * "show my first name" is checked for this message (unchecked by default and
 * after every send, D-CW-15, WBN-09). A failed send keeps the draft.
 */
function AttendeeComposer({ stage }: ComposerProps) {
  const { t } = useTranslation('calls');
  const notice = useMotionPreset('popover');
  const { text, setText, fieldError, setFieldError } = useComposerText();
  const [kind, setKind] = useState<'attendee' | 'question'>('attendee');
  const [showFirstName, setShowFirstName] = useState(false);
  const [sent, setSent] = useState(false);
  const id = useId();
  const sending = stage.isPending('message.send');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return setFieldError(t('webinar.chat.required'));
    if (value.length > WEBINAR_MESSAGE_TEXT_MAX_LENGTH) return setFieldError(t('webinar.chat.tooLong', { max: WEBINAR_MESSAGE_TEXT_MAX_LENGTH }));
    setFieldError(null);
    stage
      .sendMessage({ kind, text: value, showFirstName })
      .then(() => {
        setText('');
        setShowFirstName(false);
        setSent(true);
      })
      .catch(() => undefined);
  };

  return (
    <form onSubmit={submit} noValidate className="gap-3 p-4 flex flex-col border-t border-border-subtle" data-testid="webinar-chat-composer">
      <div className="gap-1 flex flex-col">
        <span aria-hidden className="type-label">
          {t('webinar.chat.kindLabel')}
        </span>
        <RadioGroup label={t('webinar.chat.kindLabel')} value={kind} onValueChange={(value) => setKind(value === 'question' ? 'question' : 'attendee')} className="gap-x-5 flex-row flex-wrap">
          <RadioItem value="attendee">{t('webinar.chat.kindMessage')}</RadioItem>
          <RadioItem value="question">{t('webinar.chat.kindQuestion')}</RadioItem>
        </RadioGroup>
      </div>
      <div className="gap-1.5 flex flex-col">
        <label htmlFor={`${id}-text`} className="type-label">
          {t('webinar.chat.attendeeLabel')}
        </label>
        <textarea
          id={`${id}-text`}
          rows={3}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSent(false);
          }}
          onKeyDown={submitOnModEnter}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={ids(`${id}-hint`, `${id}-count`, fieldError && `${id}-error`)}
          className={TEXTAREA_CLASS}
        />
        <p id={`${id}-count`} className="type-metadata text-text-secondary">
          {t('webinar.chat.characters', { used: text.trim().length, max: WEBINAR_MESSAGE_TEXT_MAX_LENGTH })}
        </p>
        {fieldError ? (
          <p id={`${id}-error`} className="type-metadata text-danger">
            {fieldError}
          </p>
        ) : null}
      </div>
      <Checkbox checked={showFirstName} onCheckedChange={setShowFirstName}>
        {t('webinar.chat.showFirstName')}
      </Checkbox>
      <p id={`${id}-hint`} className="type-metadata text-text-secondary">
        {t('webinar.chat.reviewHint')} {showFirstName ? null : t('webinar.chat.anonymousHint')}
      </p>
      <Button type="submit" loading={sending} loadingLabel={t('webinar.chat.sending')} leadingIcon={<PaperPlaneRight size={18} />} className="self-start">
        {t('webinar.chat.send')}
      </Button>
      <AnimatePresence initial={false}>
        {sent ? (
          <m.p key="sent" {...notice} role="status" data-testid="webinar-chat-sent-notice" className="p-3 rounded-control bg-info-surface text-info type-metadata origin-top">
            {t('webinar.messageSubmitted')}
          </m.p>
        ) : null}
      </AnimatePresence>
    </form>
  );
}

/** Hosts post to everyone; the message is published at once (CW-R-103). */
function HostComposer({ stage }: ComposerProps) {
  const { t } = useTranslation('calls');
  const { text, setText, fieldError, setFieldError } = useComposerText();
  const id = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return setFieldError(t('webinar.chat.required'));
    if (value.length > WEBINAR_MESSAGE_TEXT_MAX_LENGTH) return setFieldError(t('webinar.chat.tooLong', { max: WEBINAR_MESSAGE_TEXT_MAX_LENGTH }));
    setFieldError(null);
    stage
      .sendMessage({ kind: 'host', text: value })
      .then(() => setText(''))
      .catch(() => undefined);
  };

  return (
    <form onSubmit={submit} noValidate className="gap-2 p-4 flex flex-col border-t border-border-subtle" data-testid="webinar-chat-composer">
      <label htmlFor={`${id}-text`} className="type-label">
        {t('webinar.chat.hostLabel')}
      </label>
      <textarea
        id={`${id}-text`}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={submitOnModEnter}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={ids(`${id}-count`, fieldError && `${id}-error`)}
        className={TEXTAREA_CLASS}
      />
      <p id={`${id}-count`} className="type-metadata text-text-secondary">
        {t('webinar.chat.characters', { used: text.trim().length, max: WEBINAR_MESSAGE_TEXT_MAX_LENGTH })}
      </p>
      {fieldError ? (
        <p id={`${id}-error`} className="type-metadata text-danger">
          {fieldError}
        </p>
      ) : null}
      <Button type="submit" loading={stage.isPending('message.send')} loadingLabel={t('webinar.chat.sending')} leadingIcon={<PaperPlaneRight size={18} />} className="self-start">
        {t('webinar.chat.sendHost')}
      </Button>
    </form>
  );
}

/**
 * The webinar chat (D-CW-35; replaces the Q&A panel). One panel, two
 * directions: hosts post to everyone; attendees write to the hosts, and their
 * messages reach the audience only when a host publishes them. Attendees and
 * presenters see published and answered messages; the moderator also sees
 * pending and dismissed ones and reviews pending ones in place. New messages
 * animate in and are announced politely (WBN-15); the feed is a focusable
 * scroll region for the keyboard.
 */
export function ChatPanel({ client, error, className }: ChatPanelProps) {
  const { t } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const itemMotion = useMotionPreset('popover');
  const titleId = useId();
  const feedRef = useRef<HTMLDivElement>(null);
  const feed = feedOf(stage);
  const errors = useErrorMessages(error, stage.errorOf('chat'), stage.isModerator ? stage.errorOf('moderation') : null);

  const announcement = useChangeAnnouncement(stage.publicMessages, (previous, next) => {
    const before = new Map(previous.map((message) => [message.id, message.status]));
    const changed = next.filter((message) => before.get(message.id) !== message.status);
    const latest = changed.at(-1);
    if (!latest) return null;
    if (latest.status === 'answered') return t('webinar.chat.answered');
    if (stage.ownMessageIds.includes(latest.id) && latest.kind !== 'host') return t('webinar.messagePublished');
    return t('webinar.chat.newMessage');
  });

  const count = feed.length;
  useEffect(() => {
    const element = feedRef.current;
    if (element && count > 0) element.scrollTop = element.scrollHeight;
  }, [count]);

  return (
    <MotionFeatures>
      <section aria-labelledby={titleId} className={cn('flex min-h-0 flex-col rounded-card border border-border-subtle bg-surface text-text', className)} data-testid="webinar-chat-panel">
        <h2 id={titleId} className="gap-2 px-4 pt-4 pb-2 flex items-center type-section-title">
          <ChatCircleText size={22} aria-hidden />
          {t('webinar.chat.title')}
        </h2>
        <div className="gap-2 px-4 flex flex-col">
          <ErrorStack messages={errors} testId="webinar-chat-error" />
        </div>
        {/* A scrollable region must be reachable from the keyboard (WCAG 2.1.1). */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div ref={feedRef} role="region" aria-label={t('webinar.chat.feedLabel')} tabIndex={0} className="px-4 min-h-32 flex-1 overflow-y-auto focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focus">
          {feed.length === 0 ? (
            <p className="py-4 type-body text-text-secondary">{t('webinar.chat.empty')}</p>
          ) : (
            <ol className="gap-2 py-2 flex flex-col">
              <AnimatePresence initial={false}>
                {feed.map((entry) => (
                  <m.li key={entry.message.id} {...itemMotion} className="origin-bottom">
                    {entry.kind === 'review' ? (
                      <ModerationMessageCard
                        message={entry.message}
                        busy={busyOf(stage, entry.message.id)}
                        onPublish={(text) => stage.publish(entry.message.id, text)}
                        onAnswer={(answerText) => stage.answer(entry.message.id, answerText)}
                        onDismiss={() => stage.dismiss(entry.message.id)}
                      />
                    ) : (
                      <ChatMessageItem message={entry.message} showStatus={stage.isModerator} />
                    )}
                  </m.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </div>
        {stage.isHost ? <HostComposer stage={stage} /> : <AttendeeComposer stage={stage} />}
        <Announcer announcement={announcement} testId="webinar-chat-announcer" />
      </section>
    </MotionFeatures>
  );
}
