import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/_hr/hr/reports')({
  component: ReportsPage,
});

function ReportsPage() {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:hr.programme')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('workspace:hr.programme')}
        body={t('common:sample.demoNoop')}
      />
    </div>
  );
}
