import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Text, Avatar } from '@nestself/ui';
import { SAMPLE_CHANNELS, SAMPLE_POSTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

export const Route = createFileRoute('/_authenticated/channels/$channelId')({
  component: ChannelPage,
});

function ChannelPage() {
  const { channelId } = Route.useParams();
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  const channel = SAMPLE_CHANNELS.find((c) => c.id === channelId);
  const posts = SAMPLE_POSTS.filter((p) => p.channelId === channelId);

  const findPerson = (authorId: string) =>
    SAMPLE_PEOPLE.find((p) => p.id === authorId);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {channel?.name ?? channelId}
      </Heading>

      <div className="space-y-4">
        {posts.map((post) => {
          const person = findPerson(post.authorId);
          return (
            <div
              key={post.id}
              className="rounded-card border border-border-subtle bg-surface p-4"
            >
              <div className="flex items-center gap-3 mb-2">
                <Avatar
                  initials={person?.initials ?? '??'}
                  name={person?.displayName ?? post.authorId}
                  size="sm"
                />
                <div>
                  <Text className="font-[var(--font-weight-label)]">
                    {person?.displayName ?? post.authorId}
                  </Text>
                  <Text className="type-metadata text-text-secondary">
                    {formatDate(post.createdAt, locale)}
                  </Text>
                </div>
              </div>
              <Text>{post.content}</Text>
            </div>
          );
        })}
      </div>

      {/* Disabled composer */}
      <div className="rounded-card border border-border-subtle bg-surface p-4 opacity-60">
        <Text className="type-metadata text-text-secondary">
          {t('workspace:messages.typeMessage')}
        </Text>
        <Text className="mt-2 type-metadata text-text-secondary italic">
          {t('common:sample.demoNoop')}
        </Text>
      </div>
    </div>
  );
}
