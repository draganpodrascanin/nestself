/**
 * The two conversation lists: the expert's assigned cases (`/cases`) and the
 * employee's own conversations (`/conversations`). Metadata only; bodies
 * appear on the read-only view behind each row. In sample mode the rows come
 * from `SAMPLE_CONVERSATIONS` and the API is not called.
 */
import { useTranslation } from 'react-i18next';
import type { ProfessionalApi } from '@nestself/api-client';
import { Alert, Heading, Text } from '@nestself/ui';
import { useAuth } from '../../auth';
import { casesErrorKey } from './cases-errors';
import { ConversationTable } from './conversation-table';
import { sampleAssigned, sampleMine } from './sample-cases';
import { useAssignedConversations, useMyConversations } from './use-cases';
import { useExpertContext } from './use-expert-context';

export interface ConversationListScreenProps {
  pro: ProfessionalApi;
  /** Sample mode: fixtures instead of the API. */
  sampleMode: boolean;
}

export function AssignedCasesScreen({ pro, sampleMode }: ConversationListScreenProps) {
  const { principal } = useAuth();
  const { ready, switchError } = useExpertContext(sampleMode);
  // Without an expert record there is no expert context to wait for: the
  // route let the user in on the action alone, so read in the current one.
  const enabled = !sampleMode && (ready || (principal !== null && principal.expert === null));
  const query = useAssignedConversations(pro, enabled);
  return (
    <ListBody
      view="expert"
      sampleRows={sampleMode && principal ? sampleAssigned(principal.userId) : null}
      query={query}
      switchError={switchError}
    />
  );
}

export function MyConversationsScreen({ pro, sampleMode }: ConversationListScreenProps) {
  const { principal } = useAuth();
  const query = useMyConversations(pro, !sampleMode);
  return (
    <ListBody
      view="participant"
      sampleRows={sampleMode && principal ? sampleMine(principal.userId) : null}
      query={query}
      switchError={null}
    />
  );
}

type ListQuery = ReturnType<typeof useAssignedConversations>;

function ListBody({
  view,
  sampleRows,
  query,
  switchError,
}: {
  view: 'expert' | 'participant';
  sampleRows: ReturnType<typeof sampleAssigned> | null;
  query: ListQuery;
  switchError: unknown;
}) {
  const { t } = useTranslation(['workspace', 'common']);
  const ns = view === 'expert' ? 'cases' : 'conversations';

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t(`workspace:${ns}.title`)}</Heading>
      <Text tone="secondary">{t(`workspace:${ns}.lead`)}</Text>
    </div>
  );

  const rows = sampleRows ?? query.data?.pages.flatMap((p) => p.items);
  const loadError = sampleRows === null && query.isError && !query.isFetchNextPageError ? query.error : null;

  let body;
  if (switchError) {
    body = (
      <Alert tone="danger" title={t('workspace:cases.errors.contextTitle')}>
        {t('workspace:cases.errors.context')}
      </Alert>
    );
  } else if (loadError) {
    body = (
      <Alert tone="danger" title={t('workspace:cases.errors.listTitle')}>
        {t(`workspace:cases.errors.${casesErrorKey(loadError)}`)}
      </Alert>
    );
  } else if (rows === undefined) {
    body = <Text tone="secondary">{t('workspace:cases.loading')}</Text>;
  } else if (rows.length === 0) {
    body = <Text tone="secondary">{t(`workspace:${ns}.empty`)}</Text>;
  } else {
    body = (
      <ConversationTable
        rows={rows}
        view={view}
        hasMore={sampleRows === null && Boolean(query.hasNextPage)}
        loadingMore={query.isFetchingNextPage}
        loadMoreError={sampleRows === null && query.isFetchNextPageError ? query.error : null}
        onLoadMore={() => void query.fetchNextPage()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {sampleRows !== null ? <Alert tone="info">{t('workspace:cases.sampleNote')}</Alert> : null}
      {body}
    </div>
  );
}
