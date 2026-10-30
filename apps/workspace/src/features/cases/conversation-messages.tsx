/**
 * Read-only conversation messages, oldest first. There is no composer: the
 * web expert area and the participant view only read. Bodies are rendered as
 * text and never logged.
 */
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ConversationMessage } from '@nestself/contracts';
import { Text } from '@nestself/ui';

export interface ConversationMessagesProps {
  messages: ConversationMessage[];
  /** The signed-in user, whose messages are labelled "You". */
  viewerUserId: string;
}

export function ConversationMessages({ messages, viewerUserId }: ConversationMessagesProps) {
  const { t, i18n } = useTranslation('workspace');
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  if (messages.length === 0) {
    return <Text tone="secondary">{t('workspace:cases.messages.empty')}</Text>;
  }

  return (
    <ol aria-label={t('workspace:cases.messages.label')} className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className="rounded-control border border-border-subtle bg-surface p-4 space-y-1">
          <p className="type-metadata text-text-secondary">
            <span className="type-label text-text">
              {m.authorUserId === viewerUserId
                ? t('workspace:cases.messages.you')
                : t('workspace:cases.messages.participant', { id: m.authorUserId })}
            </span>{' '}
            <time dateTime={m.createdAt}>{formatDateTime(m.createdAt, locale)}</time>
          </p>
          <p className="type-body text-text whitespace-pre-wrap">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
