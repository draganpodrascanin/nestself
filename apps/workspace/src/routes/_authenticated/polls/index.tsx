import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/polls/')({
  component: PollsPage,
});

function PollsPage() {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:polls.title')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('workspace:polls.noPollsActive')}
        body={t('common:sample.demoNoop')}
      />
    </div>
  );
}
