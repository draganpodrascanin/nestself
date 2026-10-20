import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/_hr/hr/events')({
  component: EventsPage,
});

function EventsPage() {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('common:nav.manage')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('common:nav.manage')}
        body={t('common:sample.demoNoop')}
      />
    </div>
  );
}
