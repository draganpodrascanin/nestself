import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Heading, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { accessErrorKey } from '../access/access-errors';
import { grantStatus } from '../access/access-labels';
import { sampleMembers, sampleOrgGrants } from '../access/sample-access';
import { TransferOwnershipDialog } from '../access/transfer-ownership-dialog';
import { useOperationsContext, useOrgGrants, useOrgMembers } from '../access/use-ops-admin';
import { ORGANIZATION_STATUS_TONE } from './organization-labels';
import { organizationErrorKey } from './organization-errors';
import { sampleOrganization } from './sample-organizations';
import { useOrganization } from './use-organizations';

export interface OrgOverviewScreenProps {
  opsApi: OpsAdminApi;
  orgId: string;
  /** Sample mode: fixtures instead of the API, and every mutation disabled. */
  sampleMode: boolean;
}

/**
 * The organization's own fields and its owner (the active `employer_owner`
 * grant), with **Transfer ownership** through the operations route, which
 * also sets the first owner when there is none.
 */
export function OrgOverviewScreen({ opsApi, orgId, sampleMode }: OrgOverviewScreenProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const ownerHeadingId = useId();
  const { principal, effectiveActions } = useAuth();
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  // The grant and member lists behind the owner card are `access.preview` and `client.configure` routes.
  const canPreview = allowed('access.preview');
  const canTransfer = allowed('access.grant');

  const apiOrgId = ready ? orgId : null;
  const orgQuery = useOrganization(opsApi, apiOrgId);
  const grantsQuery = useOrgGrants(opsApi, canPreview ? apiOrgId : null);
  const membersQuery = useOrgMembers(opsApi, canPreview ? apiOrgId : null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferKey, setTransferKey] = useState(0);

  const org = sampleMode ? sampleOrganization(orgId) : orgQuery.data;
  const orgError = sampleMode
    ? org === null
      ? 'notFound'
      : null
    : orgQuery.isError
      ? organizationErrorKey(orgQuery.error)
      : null;
  const grants = sampleMode ? sampleOrgGrants(orgId) : grantsQuery.data;
  const members = sampleMode ? sampleMembers(orgId) : (membersQuery.data ?? []);
  const grantsError = !sampleMode && grantsQuery.isError ? (accessErrorKey(grantsQuery.error) ?? 'unknown') : null;
  const membersError = !sampleMode && membersQuery.isError ? (accessErrorKey(membersQuery.error) ?? 'unknown') : null;
  const owner = grants?.find((g) => g.templateKey === 'employer_owner' && grantStatus(g) === 'active') ?? null;
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.displayName ?? userId;

  if (!sampleMode && switchError) {
    return (
      <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')}>
        {t(`admin:access.errors.${switchError}`)}
      </Alert>
    );
  }

  return (
    <div className="space-y-8">
      {sampleMode ? <Alert tone="info">{t('admin:organizations.sampleNote')}</Alert> : null}

      {orgError ? (
        <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')}>
          {t(`admin:organizations.errors.${orgError}`)}
        </Alert>
      ) : !org ? (
        <Text tone="secondary">{t('admin:organizations.loading')}</Text>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="type-label text-text-secondary">{t('admin:organizations.id')}</dt>
            <dd className="m-0 type-body">{org.id}</dd>
          </div>
          <div className="space-y-1">
            <dt className="type-label text-text-secondary">{t('admin:organizations.slug')}</dt>
            <dd className="m-0 type-body">{org.slug}</dd>
          </div>
          <div className="space-y-1">
            <dt className="type-label text-text-secondary">{t('admin:organizations.status')}</dt>
            <dd className="m-0">
              <Badge tone={ORGANIZATION_STATUS_TONE[org.status]}>{t(`admin:organizations.statuses.${org.status}`)}</Badge>
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="type-label text-text-secondary">{t('admin:organizations.created')}</dt>
            <dd className="m-0 type-body">{formatDate(org.createdAt, locale)}</dd>
          </div>
        </dl>
      )}

      {canPreview ? (
        <section aria-labelledby={ownerHeadingId}>
        <Card padding="lg" className="space-y-4">
          <Heading level={3} id={ownerHeadingId}>
            {t('admin:organizations.owner.title')}
          </Heading>
          {grantsError ? (
            <Alert tone="danger" title={t('admin:organizations.owner.loadTitle')}>
              {t(`admin:access.errors.${grantsError}`)}
            </Alert>
          ) : grants === undefined ? (
            <Text tone="secondary">{t('admin:access.loading')}</Text>
          ) : owner ? (
            <Text>{t('admin:organizations.owner.current', { name: nameOf(owner.subjectUserId) })}</Text>
          ) : (
            <Text tone="secondary">{t('admin:organizations.owner.none')}</Text>
          )}
          {membersError ? (
            <Alert tone="danger" title={t('admin:access.errors.membersLoadTitle')}>
              {t(`admin:access.errors.${membersError}`)}
            </Alert>
          ) : null}
          {canTransfer ? (
            <Button
              variant="secondary"
              disabled={sampleMode || grants === undefined || grantsError !== null}
              onClick={() => {
                setTransferKey((k) => k + 1);
                setTransferOpen(true);
              }}
            >
              {owner ? t('admin:access.transfer.open') : t('admin:organizations.owner.set')}
            </Button>
          ) : null}
        </Card>
        </section>
      ) : null}

      {canTransfer && !sampleMode ? (
        <TransferOwnershipDialog
          key={transferKey}
          open={transferOpen}
          onOpenChange={setTransferOpen}
          opsApi={opsApi}
          orgId={orgId}
          members={members.filter((m) => m.userId !== owner?.subjectUserId)}
          currentOwnerName={owner ? nameOf(owner.subjectUserId) : null}
        />
      ) : null}
    </div>
  );
}
