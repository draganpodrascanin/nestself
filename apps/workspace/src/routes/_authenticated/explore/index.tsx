/**
 * Explore route placeholder — coming in M2 (T-C1.13).
 *
 * Routes to a translated "coming in the next release" StatusBlock.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBlock, SampleDataBanner } from '@nestself/ui';
import { isSampleDataMode } from '../../../data-source';

export const Route = createFileRoute('/_authenticated/explore/')({
  component: ExplorePlaceholder,
});

function ExplorePlaceholder() {
  const { t } = useTranslation(['library', 'common']);

  return (
    <div className="space-y-6">
      {isSampleDataMode ? <SampleDataBanner message={t('common:sample.banner')} /> : null}
      <StatusBlock
        state="empty"
        title={t('library:explore.comingSoon.title')}
        body={t('library:explore.comingSoon.body')}
      />
    </div>
  );
}
