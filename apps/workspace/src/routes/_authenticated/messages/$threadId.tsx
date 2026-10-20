import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/messages/$threadId')({
  component: MessageThreadPage,
});

function MessageThreadPage() {
  const { threadId: _threadId } = Route.useParams();
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:messages.title')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('workspace:messages.noConversations')}
        body={t('common:sample.demoNoop')}
      />
    </div>
  );
}
