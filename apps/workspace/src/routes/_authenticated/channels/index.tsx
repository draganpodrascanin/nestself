import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Text } from '@nestself/ui';
import { SAMPLE_CHANNELS } from '@nestself/sample-data';

export const Route = createFileRoute('/_authenticated/channels/')({
  component: ChannelsIndexPage,
});

function ChannelsIndexPage() {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:channels.title')}
      </Heading>
      <div className="space-y-3">
        {SAMPLE_CHANNELS.map((channel) => (
          <Link
            key={channel.id}
            to="/channels/$channelId"
            params={{ channelId: channel.id }}
            className="block rounded-card border border-border-subtle bg-surface p-4 hover:bg-tint transition-colors no-underline"
          >
            <Text className="font-[var(--font-weight-label)]">{channel.name}</Text>
            <Text className="type-metadata text-text-secondary">
              {channel.scope === 'org' ? t('workspace:channels.general') : channel.name}
            </Text>
          </Link>
        ))}
      </div>
    </div>
  );
}
