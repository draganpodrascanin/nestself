import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Heading, StatusBlock, Table, Td, Text, Th } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { can } from '@nestself/contracts';
import type { OrganizationResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { useOperationsContext } from '../access/use-ops-admin';
import { sampleOrganizations } from '../organizations/sample-organizations';
import { useOrganization, useOrganizationPages } from '../organizations/use-organizations';
import { ConnectionDetail } from './connection-detail';
import { CreateConnectionDialog } from './create-connection-dialog';
import { SAMPLE_SSO_ROWS } from './sample-sso';
import { ssoProblem } from './sso-errors';
import { SSO_STATUS_TONE } from './sso-labels';
import { useSsoConnections } from './use-sso';

export interface SsoScreenProps {
  opsApi: OpsAdminApi;
  /** Sample mode: the sample connections, every action disabled. */
  sampleMode: boolean;
}

/**
 * Enterprise SSO connections (auth-strategy.md 3.4): the list with status,
 * domains and certificate expiry, a dialog to create one, and a detail panel
 * per connection for domains, testing and the status lifecycle.
 *
 * Shown to principals holding `sso.manage`; that gate is convenience, the
 * server checks `sso.manage` and administration step-up on every route.
 */
export function SsoScreen({ opsApi, sampleMode }: SsoScreenProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { principal, effectiveActions } = useAuth();
  const canManage = principal ? can(principal, 'sso.manage', undefined, effectiveActions) : false;
  const { ready, error: switchError } = useOperationsContext(sampleMode || !canManage);
  const list = useSsoConnections(opsApi, ready && canManage);
  // The organization names: the first page of the client list. A connection
  // of a client beyond it is named by a read of that client (`OrganizationName`).
  const orgPages = useOrganizationPages(opsApi, ready && canManage, '');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = sampleMode ? SAMPLE_SSO_ROWS : list.data;
  const organizations: OrganizationResponse[] = sampleMode
    ? sampleOrganizations('')
    : (orgPages.data?.pages.flatMap((p) => p.items) ?? []);
  const selected = rows?.find((r) => r.id === selectedId) ?? null;
  // Until the first page has settled every client would count as "beyond it".
  const readNames = !sampleMode && ready && canManage && !orgPages.isPending;
  const selectedName = useOrganizationName(opsApi, selected?.orgId ?? null, organizations, readNames);

  if (!principal || !canManage) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  const listError = !sampleMode && list.isError ? (ssoProblem(list.error, 'load')?.key ?? 'unknown') : null;

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle align-top';

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={1}>{t('admin:sso.title')}</Heading>
        <Text tone="secondary">{t('admin:sso.intro')}</Text>
      </div>

      {sampleMode ? <Alert tone="info">{t('admin:sso.sampleNote')}</Alert> : null}

      {!sampleMode && switchError ? (
        <Alert tone="danger" title={t('admin:sso.errors.loadTitle')}>
          {t(`admin:access.errors.${switchError}`)}
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button
          disabled={sampleMode || !ready}
          onClick={() => {
            setCreateKey((k) => k + 1);
            setCreateOpen(true);
          }}
        >
          {t('admin:sso.newConnection')}
        </Button>
      </div>

      {listError === 'stepUpCancelled' ? (
        <div className="space-y-3">
          <Alert tone="info" title={t('admin:sso.errors.stepUpCancelledTitle')}>
            {t('admin:sso.errors.stepUpCancelled')}
          </Alert>
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            {t('common:action.retry')}
          </Button>
        </div>
      ) : listError ? (
        <Alert tone="danger" title={t('admin:sso.errors.loadTitle')}>
          {t(`admin:sso.errors.${listError}`)}
        </Alert>
      ) : rows === undefined ? (
        switchError ? null : <Text tone="secondary">{t('admin:sso.loading')}</Text>
      ) : rows.length === 0 ? (
        <Text tone="secondary">{t('admin:sso.empty')}</Text>
      ) : (
        <Table caption={t('admin:sso.title')}>
          <thead>
            <tr>
              <Th className={headerClass}>{t('admin:sso.columns.organization')}</Th>
              <Th className={headerClass}>{t('admin:sso.columns.provider')}</Th>
              <Th className={headerClass}>{t('admin:sso.columns.protocol')}</Th>
              <Th className={headerClass}>{t('admin:sso.columns.status')}</Th>
              <Th className={headerClass}>{t('admin:sso.columns.domains')}</Th>
              <Th className={headerClass}>{t('admin:sso.columns.lastTested')}</Th>
              <Th className={headerClass}>{t('admin:sso.columns.certificate')}</Th>
              <Th className={headerClass}>{t('admin:sso.columns.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const verified = row.domains.filter((d) => d.verifiedAt !== null).length;
              return (
                <tr key={row.id} data-testid={`sso-row-${row.id}`}>
                  <Td className={cellClass}>
                    <OrganizationName opsApi={opsApi} orgId={row.orgId} loaded={organizations} enabled={readNames} />
                  </Td>
                  <Td className={`${cellClass} type-metadata`}>{row.cognitoProviderName}</Td>
                  <Td className={cellClass}>{t(`admin:sso.protocols.${row.protocol}`)}</Td>
                  <Td className={cellClass}>
                    <Badge tone={SSO_STATUS_TONE[row.status]}>{t(`admin:sso.statuses.${row.status}`)}</Badge>
                  </Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>
                    {t('admin:sso.domainsCount', { verified, count: row.domains.length })}
                  </Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>
                    {row.lastTestedAt ? formatDate(row.lastTestedAt, locale) : t('admin:sso.never')}
                  </Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>
                    {row.certificateExpiresAt ? formatDate(row.certificateExpiresAt, locale) : t('admin:sso.notKnown')}
                  </Td>
                  <Td className={cellClass}>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-expanded={selectedId === row.id}
                      onClick={() => setSelectedId(row.id)}
                    >
                      {t('admin:sso.details')}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {selected ? (
        <ConnectionDetail
          key={selected.id}
          connection={selected}
          organizationName={selectedName ?? selected.orgId}
          opsApi={opsApi}
          sampleMode={sampleMode}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {!sampleMode ? (
        <CreateConnectionDialog
          key={`create-${createKey}`}
          open={createOpen}
          onOpenChange={setCreateOpen}
          opsApi={opsApi}
        />
      ) : null}
    </div>
  );
}

/**
 * The name of an organization: from the loaded page of the client list, else
 * from one read of that client, else its id (also when that read fails).
 * `enabled` is false in sample mode and until the list's first page settled.
 */
function useOrganizationName(
  opsApi: OpsAdminApi,
  orgId: string | null,
  loaded: OrganizationResponse[],
  enabled: boolean,
): string | null {
  const known = orgId === null ? undefined : loaded.find((o) => o.id === orgId);
  const read = useOrganization(opsApi, enabled && orgId !== null && !known ? orgId : null);
  if (orgId === null) return null;
  return known?.name ?? read.data?.name ?? orgId;
}

function OrganizationName({
  opsApi,
  orgId,
  loaded,
  enabled,
}: {
  opsApi: OpsAdminApi;
  orgId: string;
  loaded: OrganizationResponse[];
  enabled: boolean;
}) {
  const name = useOrganizationName(opsApi, orgId, loaded, enabled);
  return <>{name}</>;
}
