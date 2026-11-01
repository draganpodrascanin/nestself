import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

/** The feedback composer; arrives with the feedback-cases task. Opening it creates nothing. */
export const Route = createFileRoute('/_authenticated/feedback/new')({
  component: FeedbackComposerPlaceholder,
});

function FeedbackComposerPlaceholder() {
  const { t } = useTranslation(['listening', 'library']);
  return (
    <div className="space-y-6">
      <Heading level={1}>{t('listening:nav.feedback')}</Heading>
      <StatusBlock state="empty" title={t('library:requests.comingSoon.title')} body={t('library:requests.comingSoon.body')} />
    </div>
  );
}
