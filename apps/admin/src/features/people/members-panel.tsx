import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, Input, Select, Table, Td, Text, Th } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { MemberItem } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { EndMembershipDialog } from './end-membership-dialog';
import { LoadMore } from './load-more';
import { peopleErrorKey } from './people-errors';
import { MEMBER_STATUSES, STATUS_TONE } from './people-labels';
import type { MemberStatus } from './people-labels';
import { useMemberPages } from './use-ops-people';
import type { MemberFilters } from './use-ops-people';

/** Select value for "no filter". */
const ALL = '__all__';
/** Delay between the last keystroke in the search field and the request. */
export const SEARCH_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function matchesFilters(member: MemberItem, filters: MemberFilters): boolean {
  if (filters.status && member.status !== filters.status) return false;
  const q = filters.search.trim().toLowerCase();
  if (q && !member.displayName.toLowerCase().includes(q) && !member.email.toLowerCase().includes(q)) return false;
  return true;
}

export interface MembersPanelProps {
  opsApi: OpsAdminApi;
  orgId: string;
  /** The organization id once the API may be called; `null` in sample mode. */
  apiOrgId: string | null;
  sampleMode: boolean;
  sampleMembers: readonly MemberItem[];
  currentUserId: string;
  /** `people.deactivate`: end a membership. */
  canEnd: boolean;
}

/**
 * Members of one organization through the operations mirror: filter by
 * status and name or email, page with "Load more", end a membership. There
 * is no Move here: the operations mirror has no member update or org-unit
 * routes (organization placement is HR's job).
 */
export function MembersPanel({ opsApi, orgId, apiOrgId, sampleMode, sampleMembers, currentUserId, canEnd }: MembersPanelProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const filters: MemberFilters = useMemo(
    () => ({ status: statusFilter === ALL ? null : (statusFilter as MemberStatus), search: debouncedSearch }),
    [statusFilter, debouncedSearch],
  );

  const pages = useMemberPages(opsApi, apiOrgId, filters);
  const [endTarget, setEndTarget] = useState<MemberItem | null>(null);

  const members: MemberItem[] | undefined = sampleMode
    ? sampleMembers.filter((m) => matchesFilters(m, filters))
    : pages.data?.pages.flatMap((p) => p.items);
  const loadError = !sampleMode && pages.isError && !pages.isFetchNextPageError ? (peopleErrorKey(pages.error) ?? 'unknown') : null;
  const nextPageError =
    !sampleMode && pages.isFetchNextPageError ? t(`admin:people.errors.${peopleErrorKey(pages.error) ?? 'unknown'}`) : null;

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t('admin:people.filters.status')}>
          <Select
            options={[
              { value: ALL, label: t('admin:people.filters.allStatuses') },
              ...MEMBER_STATUSES.map((s) => ({ value: s, label: t(`admin:people.status.${s}`) })),
            ]}
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? ALL)}
          />
        </Field>
        <Field label={t('admin:people.filters.search')} description={t('admin:people.filters.searchHint')}>
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        </Field>
      </div>

      {loadError ? (
        <Alert tone="danger" title={t('admin:people.errors.membersLoadTitle')}>
          {t(`admin:people.errors.${loadError}`)}
        </Alert>
      ) : members === undefined ? (
        <Text tone="secondary">{t('admin:people.loading')}</Text>
      ) : members.length === 0 ? (
        <Text tone="secondary">{t('admin:people.members.empty')}</Text>
      ) : (
        <>
          <Table caption={t('admin:people.members.caption')}>
            <thead>
              <tr>
                <Th className={headerClass}>{t('admin:people.columns.name')}</Th>
                <Th className={headerClass}>{t('admin:people.columns.email')}</Th>
                <Th className={headerClass}>{t('admin:people.columns.status')}</Th>
                <Th className={headerClass}>{t('admin:people.columns.startDate')}</Th>
                {canEnd ? <Th className={headerClass}>{t('admin:people.columns.actions')}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const endable = m.status !== 'ENDED' && m.userId !== currentUserId;
                return (
                  <tr key={m.membershipId} data-membership-id={m.membershipId}>
                    <Td className={cellClass}>{m.displayName}</Td>
                    <Td className={`${cellClass} type-metadata text-text-secondary`}>{m.email}</Td>
                    <Td className={cellClass}>
                      <Badge tone={STATUS_TONE[m.status]}>{t(`admin:people.status.${m.status}`)}</Badge>
                    </Td>
                    <Td className={`${cellClass} type-metadata text-text-secondary`}>{formatDate(m.startDate, locale)}</Td>
                    {canEnd ? (
                      <Td className={cellClass}>
                        {endable ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={sampleMode}
                            aria-label={t('admin:people.end.openFor', { name: m.displayName })}
                            onClick={() => setEndTarget(m)}
                          >
                            {t('admin:people.end.open')}
                          </Button>
                        ) : null}
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <LoadMore
            shown={members.length}
            hasMore={!sampleMode && pages.hasNextPage}
            loading={pages.isFetchingNextPage}
            errorMessage={nextPageError}
            onLoadMore={() => void pages.fetchNextPage()}
          />
        </>
      )}

      {canEnd && !sampleMode ? (
        <EndMembershipDialog member={endTarget} onClose={() => setEndTarget(null)} opsApi={opsApi} orgId={orgId} />
      ) : null}
    </div>
  );
}
