import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

/** One review request; arrives with the workplace-reviews task. */
export const Route = createFileRoute('/_authenticated/_listening/listening/reviews/$requestId')({
  component: RequestDetailPlaceholder,
});

function RequestDetailPlaceholder() {
  const { t } = useTranslation(['listening', 'library']);
  return (
    <div className="space-y-6">
      <Heading level={1}>{t('listening:offer.viewRequest')}</Heading>
      <StatusBlock state="empty" title={t('library:requests.comingSoon.title')} body={t('library:requests.comingSoon.body')} />
    </div>
  );
}
