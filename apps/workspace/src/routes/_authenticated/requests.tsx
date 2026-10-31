/**
 * My requests route placeholder — in development (T-C1.13).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/requests')({
  component: RequestsPlaceholder,
});

function RequestsPlaceholder() {
  const { t } = useTranslation(['library', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('library:requests.comingSoon.title')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('library:requests.comingSoon.title')}
        body={t('library:requests.comingSoon.body')}
      />
    </div>
  );
}
