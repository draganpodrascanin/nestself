import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@nestself/ui';

export interface LoadMoreProps {
  /** Rows on screen. */
  shown: number;
  hasMore: boolean;
  loading: boolean;
  /** Translated message of the failed request for the next page, if any. */
  errorMessage: string | null;
  onLoadMore: () => void;
}

/**
 * Footer of a cursor-paged table: how many rows are on screen, whether more
 * exist, and a button that appends the next page. A list is never capped
 * silently.
 */
export function LoadMore({ shown, hasMore, loading, errorMessage, onLoadMore }: LoadMoreProps) {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <p role="status" className="type-body text-text-secondary">
          {hasMore ? t('admin:paging.showingMore', { count: shown }) : t('admin:paging.showing', { count: shown })}
        </p>
        {hasMore ? (
          <Button variant="secondary" size="sm" loading={loading} onClick={onLoadMore}>
            {t('admin:paging.loadMore')}
          </Button>
        ) : null}
      </div>
      {errorMessage ? (
        <Alert tone="danger" title={t('admin:paging.loadMoreFailed')}>
          {errorMessage}
        </Alert>
      ) : null}
    </div>
  );
}
