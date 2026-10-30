import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@nestself/ui';
import { peopleErrorKey } from './people-errors';

export interface LoadMoreProps {
  /** Rows on screen. */
  shown: number;
  hasMore: boolean;
  loading: boolean;
  /** The failed request for the next page, if any. */
  error: unknown;
  onLoadMore: () => void;
}

/**
 * Footer of a cursor-paged table: how many rows are on screen, whether more
 * exist, and a button that appends the next page. A list is never capped
 * silently (Review Focus 2).
 */
export function LoadMore({ shown, hasMore, loading, error, onLoadMore }: LoadMoreProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const errorKey = error ? (peopleErrorKey(error) ?? 'unknown') : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <p role="status" className="type-body text-text-secondary">
          {hasMore
            ? t('workspace:people.paging.showingMore', { count: shown })
            : t('workspace:people.paging.showing', { count: shown })}
        </p>
        {hasMore ? (
          <Button variant="secondary" size="sm" loading={loading} onClick={onLoadMore}>
            {t('workspace:people.paging.loadMore')}
          </Button>
        ) : null}
      </div>
      {errorKey ? (
        <Alert tone="danger" title={t('workspace:people.paging.loadMoreFailed')}>
          {t(`workspace:people.errors.${errorKey}`)}
        </Alert>
      ) : null}
    </div>
  );
}
