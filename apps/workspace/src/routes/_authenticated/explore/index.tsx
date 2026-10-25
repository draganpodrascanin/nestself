/**
 * Explore route placeholder — in development (T-C1.13).
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, StatusBlock } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { isSampleDataMode } from '../../../data-source';

export const Route = createFileRoute('/_authenticated/explore/')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (
      !isSampleDataMode &&
      principal &&
      !can(principal, 'content.read', undefined, effectiveActions)
    ) {
      throw redirect({ to: '/', search: { denied: 'explore' } });
    }
  },
  component: ExplorePlaceholder,
});

function ExplorePlaceholder() {
  const { t } = useTranslation(['library', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('library:explore.comingSoon.title')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('library:explore.comingSoon.title')}
        body={t('library:explore.comingSoon.body')}
      />
    </div>
  );
}
