import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, Input, Select, Table, Td, Text, Th } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { MemberItem, OrgUnitResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { EndMembershipDialog } from './end-membership-dialog';
import { LoadMore } from './load-more';
import { MoveMemberDialog } from './move-member-dialog';
import { peopleErrorKey } from './people-errors';
import { MEMBER_STATUSES, STATUS_TONE, activeUnits } from './people-labels';
import type { MemberStatus } from './people-labels';
import { useActiveMemberDirectory, useMemberPages } from './use-people';
import type { MemberFilters } from './use-people';

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
  if (filters.orgUnitId && member.orgUnitId !== filters.orgUnitId) return false;
  if (filters.status && member.status !== filters.status) return false;
  const q = filters.search.trim().toLowerCase();
  if (q && !member.displayName.toLowerCase().includes(q) && !member.email.toLowerCase().includes(q)) return false;
  return true;
}

export interface MembersPanelProps {
  adminApi: OrgAdminApi;
  orgId: string;
  /** The organization id once the API may be called; `null` in sample mode. */
  apiOrgId: string | null;
  sampleMode: boolean;
  sampleMembers: readonly MemberItem[];
  orgUnits: readonly OrgUnitResponse[];
  currentUserId: string;
  canMove: boolean;
  canEnd: boolean;
}

export function MembersPanel({
  adminApi,
  orgId,
  apiOrgId,
  sampleMode,
  sampleMembers,
  orgUnits,
  currentUserId,
  canMove,
  canEnd,
}: MembersPanelProps) {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  const [orgUnitFilter, setOrgUnitFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const filters: MemberFilters = useMemo(
    () => ({
      orgUnitId: orgUnitFilter === ALL ? null : orgUnitFilter,
      status: statusFilter === ALL ? null : (statusFilter as MemberStatus),
      search: debouncedSearch,
    }),
    [orgUnitFilter, statusFilter, debouncedSearch],
  );

  const pages = useMemberPages(adminApi, apiOrgId, filters);
  const directory = useActiveMemberDirectory(adminApi, apiOrgId);

  const [moveTarget, setMoveTarget] = useState<MemberItem | null>(null);
  const [endTarget, setEndTarget] = useState<MemberItem | null>(null);

  const members: MemberItem[] | undefined = sampleMode
    ? sampleMembers.filter((m) => matchesFilters(m, filters))
    : pages.data?.pages.flatMap((p) => p.items);
  const managers = sampleMode ? sampleMembers.filter((m) => m.status === 'ACTIVE') : (directory.data ?? []);
  const loadError = !sampleMode && pages.isError && !pages.isFetchNextPageError ? (peopleErrorKey(pages.error) ?? 'unknown') : null;
  const directoryError = !sampleMode && directory.isError ? (peopleErrorKey(directory.error) ?? 'unknown') : null;

  const unitName = (id: string | null) => {
    if (id === null) return t('workspace:people.members.noUnit');
    return orgUnits.find((u) => u.id === id)?.name ?? t('workspace:people.members.unknownUnit');
  };
  const managerName = (id: string | null) => {
    if (id === null) return t('workspace:people.members.noLineManager');
    return managers.find((m) => m.userId === id)?.displayName ?? t('workspace:people.members.unknownPerson');
  };

  const assignableUnits = activeUnits(orgUnits);
  const showActions = canMove || canEnd;
  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={t('workspace:people.filters.orgUnit')}>
          <Select
            options={[
              { value: ALL, label: t('workspace:people.filters.allUnits') },
              ...assignableUnits.map((u) => ({ value: u.id, label: u.name })),
            ]}
            value={orgUnitFilter}
            onValueChange={(v) => setOrgUnitFilter(v ?? ALL)}
          />
        </Field>
        <Field label={t('workspace:people.filters.status')}>
          <Select
            options={[
              { value: ALL, label: t('workspace:people.filters.allStatuses') },
              ...MEMBER_STATUSES.map((s) => ({ value: s, label: t(`workspace:people.status.${s}`) })),
            ]}
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? ALL)}
          />
        </Field>
        <Field label={t('workspace:people.filters.search')} description={t('workspace:people.filters.searchHint')}>
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        </Field>
      </div>

      {directoryError ? (
        <Alert tone="danger" title={t('workspace:people.errors.directoryLoadTitle')}>
          {t(`workspace:people.errors.${directoryError}`)}
        </Alert>
      ) : null}

      {loadError ? (
        <Alert tone="danger" title={t('workspace:people.errors.membersLoadTitle')}>
          {t(`workspace:people.errors.${loadError}`)}
        </Alert>
      ) : members === undefined ? (
        <Text tone="secondary">{t('workspace:people.loading')}</Text>
      ) : members.length === 0 ? (
        <Text tone="secondary">{t('workspace:people.members.empty')}</Text>
      ) : (
        <>
          <Table caption={t('workspace:people.members.caption')}>
            <thead>
              <tr>
                <Th className={headerClass}>{t('workspace:people.columns.name')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.email')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.orgUnit')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.lineManager')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.status')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.startDate')}</Th>
                {showActions ? <Th className={headerClass}>{t('workspace:people.columns.actions')}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const movable = canMove && m.status !== 'ENDED';
                const endable = canEnd && m.status !== 'ENDED' && m.userId !== currentUserId;
                return (
                  <tr key={m.membershipId} data-membership-id={m.membershipId}>
                    <Td className={cellClass}>{m.displayName}</Td>
                    <Td className={`${cellClass} type-metadata text-text-secondary`}>{m.email}</Td>
                    <Td className={cellClass}>{unitName(m.orgUnitId)}</Td>
                    <Td className={cellClass}>{managerName(m.lineManagerUserId)}</Td>
                    <Td className={cellClass}>
                      <Badge tone={STATUS_TONE[m.status]}>{t(`workspace:people.status.${m.status}`)}</Badge>
                    </Td>
                    <Td className={`${cellClass} type-metadata text-text-secondary`}>{formatDate(m.startDate, locale)}</Td>
                    {showActions ? (
                      <Td className={cellClass}>
                        <div className="flex flex-wrap gap-2">
                          {movable ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={sampleMode}
                              aria-label={t('workspace:people.move.openFor', { name: m.displayName })}
                              onClick={() => setMoveTarget(m)}
                            >
                              {t('workspace:people.move.open')}
                            </Button>
                          ) : null}
                          {endable ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={sampleMode}
                              aria-label={t('workspace:people.end.openFor', { name: m.displayName })}
                              onClick={() => setEndTarget(m)}
                            >
                              {t('workspace:people.end.open')}
                            </Button>
                          ) : null}
                        </div>
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
            error={pages.isFetchNextPageError ? pages.error : null}
            onLoadMore={() => void pages.fetchNextPage()}
          />
        </>
      )}

      {canMove && !sampleMode ? (
        <MoveMemberDialog
          member={moveTarget}
          onClose={() => setMoveTarget(null)}
          adminApi={adminApi}
          orgId={orgId}
          orgUnits={assignableUnits}
          managers={managers}
        />
      ) : null}

      {canEnd && !sampleMode ? (
        <EndMembershipDialog member={endTarget} onClose={() => setEndTarget(null)} adminApi={adminApi} orgId={orgId} />
      ) : null}
    </div>
  );
}
