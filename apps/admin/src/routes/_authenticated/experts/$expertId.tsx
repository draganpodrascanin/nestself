import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';

function ExpertDetailPage() {
  const { expertId } = Route.useParams();
  const { t } = useTranslation('admin');

  return (
    <div>
      <Heading level={1}>{t('experts.detail')}</Heading>
      <StatusBlock
        state="empty"
        title={expertId}
        body={t('experts.detail')}
        className="mt-6"
      />
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/experts/$expertId')({
  component: ExpertDetailPage,
});
