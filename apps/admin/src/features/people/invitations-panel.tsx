import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Table, Td, Text, Th } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { InvitationResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { templateLabel } from '../access/access-labels';
import { ImportDialog } from './import-dialog';
import { InviteDialog } from './invite-dialog';
import { LoadMore } from './load-more';
import { peopleErrorKey } from './people-errors';
import { RevokeInvitationDialog } from './revoke-invitation-dialog';
import { useInvitationPages } from './use-ops-people';

export interface InvitationsPanelProps {
  opsApi: OpsAdminApi;
  orgId: string;
  apiOrgId: string | null;
  sampleMode: boolean;
  sampleInvitations: readonly InvitationResponse[];
  /** `people.onboard`: list, invite and revoke. */
  canOnboard: boolean;
  /** `people.import`: bulk import. */
  canImport: boolean;
}

export function InvitationsPanel({
  opsApi,
  orgId,
  apiOrgId,
  sampleMode,
  sampleInvitations,
  canOnboard,
  canImport,
}: InvitationsPanelProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  // The pending list is a `people.onboard` route.
  const pages = useInvitationPages(opsApi, canOnboard ? apiOrgId : null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteKey, setInviteKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<InvitationResponse | null>(null);

  const invitations = sampleMode ? [...sampleInvitations] : pages.data?.pages.flatMap((p) => p.items);
  const loadError = !sampleMode && pages.isError && !pages.isFetchNextPageError ? (peopleErrorKey(pages.error) ?? 'unknown') : null;
  const nextPageError =
    !sampleMode && pages.isFetchNextPageError ? t(`admin:people.errors.${peopleErrorKey(pages.error) ?? 'unknown'}`) : null;

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {canOnboard ? (
          <Button
            disabled={sampleMode}
            onClick={() => {
              setInviteKey((k) => k + 1);
              setInviteOpen(true);
            }}
          >
            {t('admin:people.invite.open')}
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
            {t('admin:people.import.open')}
          </Button>
        ) : null}
      </div>

      {!canOnboard ? null : loadError ? (
        <Alert tone="danger" title={t('admin:people.errors.invitationsLoadTitle')}>
          {t(`admin:people.errors.${loadError}`)}
        </Alert>
      ) : invitations === undefined ? (
        <Text tone="secondary">{t('admin:people.loading')}</Text>
      ) : invitations.length === 0 ? (
        <Text tone="secondary">{t('admin:people.invitations.empty')}</Text>
      ) : (
        <>
          <Table caption={t('admin:people.invitations.caption')}>
            <thead>
              <tr>
                <Th className={headerClass}>{t('admin:people.columns.email')}</Th>
                <Th className={headerClass}>{t('admin:people.columns.template')}</Th>
                <Th className={headerClass}>{t('admin:people.columns.orgUnit')}</Th>
                <Th className={headerClass}>{t('admin:people.columns.expires')}</Th>
                <Th className={headerClass}>{t('admin:people.columns.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} data-invitation-id={inv.id}>
                  <Td className={cellClass}>{inv.email}</Td>
                  <Td className={cellClass}>{templateLabel(t, inv.templateKey)}</Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>
                    {inv.orgUnitId ?? t('admin:people.invitations.noOrgUnit')}
                  </Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>{formatDate(inv.expiresAt, locale)}</Td>
                  <Td className={cellClass}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={sampleMode}
                      aria-label={t('admin:people.revoke.openFor', { email: inv.email })}
                      onClick={() => setRevokeTarget(inv)}
                    >
                      {t('admin:people.revoke.open')}
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
            errorMessage={nextPageError}
            onLoadMore={() => void pages.fetchNextPage()}
          />
        </>
      )}

      {canOnboard && !sampleMode ? (
        <InviteDialog key={`invite-${inviteKey}`} open={inviteOpen} onOpenChange={setInviteOpen} opsApi={opsApi} orgId={orgId} />
      ) : null}

      {canImport && !sampleMode ? (
        <ImportDialog key={`import-${importKey}`} open={importOpen} onOpenChange={setImportOpen} opsApi={opsApi} orgId={orgId} />
      ) : null}

      {canOnboard && !sampleMode ? (
        <RevokeInvitationDialog invitation={revokeTarget} onClose={() => setRevokeTarget(null)} opsApi={opsApi} orgId={orgId} />
      ) : null}
    </div>
  );
}
