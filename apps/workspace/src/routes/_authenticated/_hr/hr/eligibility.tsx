import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/_hr/hr/eligibility')({
  component: EligibilityPage,
});

function EligibilityPage() {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:hr.eligible')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('workspace:hr.eligible')}
        body={t('common:sample.demoNoop')}
      />
    </div>
  );
}
