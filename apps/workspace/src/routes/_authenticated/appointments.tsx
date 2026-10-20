import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/appointments')({
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('common:nav.appointments')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('common:state.empty.title')}
        body={t('common:state.empty.body')}
        action={{
          label: t('common:action.findTime'),
          onClick: () => {
            // Stub: no action
          },
        }}
      />
    </div>
  );
}
