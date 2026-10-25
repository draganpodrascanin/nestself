/**
 * My requests route placeholder — coming in M3 (T-C1.13).
 *
 * Routes to a translated "coming in the next release" StatusBlock.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBlock, SampleDataBanner } from '@nestself/ui';
import { isSampleDataMode } from '../../data-source';

export const Route = createFileRoute('/_authenticated/requests')({
  component: RequestsPlaceholder,
});

function RequestsPlaceholder() {
  const { t } = useTranslation(['library', 'common']);

  return (
    <div className="space-y-6">
      {isSampleDataMode ? <SampleDataBanner message={t('common:sample.banner')} /> : null}
      <StatusBlock
        state="empty"
        title={t('library:requests.comingSoon.title')}
        body={t('library:requests.comingSoon.body')}
      />
    </div>
  );
}
