import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Table, Td, Text, Th } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { InvitationResponse, OrgUnitResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { templateLabel } from '../access/access-labels';
import { ImportDialog } from './import-dialog';
import { InviteDialog } from './invite-dialog';
import { LoadMore } from './load-more';
import { peopleErrorKey } from './people-errors';
import { activeUnits } from './people-labels';
import { RevokeInvitationDialog } from './revoke-invitation-dialog';
import { useInvitationPages } from './use-people';

export interface InvitationsPanelProps {
  adminApi: OrgAdminApi;
  orgId: string;
  apiOrgId: string | null;
  sampleMode: boolean;
  sampleInvitations: readonly InvitationResponse[];
  orgUnits: readonly OrgUnitResponse[];
  /** `people.invite`: list, invite and revoke. */
  canInvite: boolean;
  /** `people.import`: bulk import. */
  canImport: boolean;
}

export function InvitationsPanel({
  adminApi,
  orgId,
  apiOrgId,
  sampleMode,
  sampleInvitations,
  orgUnits,
  canInvite,
  canImport,
}: InvitationsPanelProps) {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  // The pending list is a `people.invite` route.
  const pages = useInvitationPages(adminApi, canInvite ? apiOrgId : null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteKey, setInviteKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<InvitationResponse | null>(null);

  const invitations = sampleMode ? [...sampleInvitations] : pages.data?.pages.flatMap((p) => p.items);
  const loadError = !sampleMode && pages.isError && !pages.isFetchNextPageError ? (peopleErrorKey(pages.error) ?? 'unknown') : null;
  const assignableUnits = activeUnits(orgUnits);
  const unitName = (id: string | null) =>
    id === null
      ? t('workspace:people.members.noUnit')
      : (orgUnits.find((u) => u.id === id)?.name ?? t('workspace:people.members.unknownUnit'));

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';

  return (
    <div className="space-y-6">
      {canInvite || canImport ? (
        <div className="flex flex-wrap gap-3">
          {canInvite ? (
            <Button
              disabled={sampleMode}
              onClick={() => {
                setInviteKey((k) => k + 1);
                setInviteOpen(true);
              }}
            >
              {t('workspace:people.invite.open')}
            </Button>
          ) : null}
          {canImport ? (
            <Button
              variant="secondary"
              disabled={sampleMode}
              onClick={() => {
                setImportKey((k) => k + 1);
                setImportOpen(true);
              }}
            >
              {t('workspace:people.import.open')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!canInvite ? null : loadError ? (
        <Alert tone="danger" title={t('workspace:people.errors.invitationsLoadTitle')}>
          {t(`workspace:people.errors.${loadError}`)}
        </Alert>
      ) : invitations === undefined ? (
        <Text tone="secondary">{t('workspace:people.loading')}</Text>
      ) : invitations.length === 0 ? (
        <Text tone="secondary">{t('workspace:people.invitations.empty')}</Text>
      ) : (
        <>
          <Table caption={t('workspace:people.invitations.caption')}>
            <thead>
              <tr>
                <Th className={headerClass}>{t('workspace:people.columns.email')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.template')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.orgUnit')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.expires')}</Th>
                <Th className={headerClass}>{t('workspace:people.columns.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} data-invitation-id={inv.id}>
                  <Td className={cellClass}>{inv.email}</Td>
                  <Td className={cellClass}>{templateLabel(t, inv.templateKey)}</Td>
                  <Td className={cellClass}>{unitName(inv.orgUnitId)}</Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>{formatDate(inv.expiresAt, locale)}</Td>
                  <Td className={cellClass}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={sampleMode}
                      aria-label={t('workspace:people.revoke.openFor', { email: inv.email })}
                      onClick={() => setRevokeTarget(inv)}
                    >
                      {t('workspace:people.revoke.open')}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <LoadMore
            shown={invitations.length}
            hasMore={!sampleMode && pages.hasNextPage}
            loading={pages.isFetchingNextPage}
            error={pages.isFetchNextPageError ? pages.error : null}
            onLoadMore={() => void pages.fetchNextPage()}
          />
        </>
      )}

      {canInvite && !sampleMode ? (
        <InviteDialog
          key={`invite-${inviteKey}`}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          adminApi={adminApi}
          orgId={orgId}
          orgUnits={assignableUnits}
        />
      ) : null}

      {canImport && !sampleMode ? (
        <ImportDialog
          key={`import-${importKey}`}
          open={importOpen}
          onOpenChange={setImportOpen}
          adminApi={adminApi}
          orgId={orgId}
          orgUnits={assignableUnits}
        />
      ) : null}

      {canInvite && !sampleMode ? (
        <RevokeInvitationDialog
          invitation={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          adminApi={adminApi}
          orgId={orgId}
        />
      ) : null}
    </div>
  );
}
