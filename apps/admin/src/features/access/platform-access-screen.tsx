import { useState } from 'react';
import type { GrantResponse } from '@nestself/contracts';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { accessErrorKey } from './access-errors';
import { AssignPlatformGrantDialog } from './assign-platform-grant-dialog';
import { GrantTable } from './grant-table';
import { templateLabel } from './access-labels';
import { RevokeGrantDialog } from './revoke-grant-dialog';
import { samplePeople, samplePlatformGrants } from './sample-access';
import { UserAccessLookup } from './user-access-lookup';
import { useOperationsContext, usePlatformGrants } from './use-ops-admin';

export interface PlatformAccessScreenProps {
  opsApi: OpsAdminApi;
  /** Sample mode: fixtures instead of the API, and every mutation disabled. */
  sampleMode: boolean;
}

/**
 * Platform-level grants (no organization): staff templates assigned at their
 * own scope, assigned and revoked through `/ops/grants` (revoking also
 * revokes the grants delegated from it).
 */
export function PlatformAccessScreen({ opsApi, sampleMode }: PlatformAccessScreenProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { principal, effectiveActions } = useAuth();
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const grantsQuery = usePlatformGrants(opsApi, ready);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignKey, setAssignKey] = useState(0);

  const [revokeTarget, setRevokeTarget] = useState<GrantResponse | null>(null);

  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canGrant = allowed('access.grant');
  const canRevoke = allowed('access.revoke');

  const grants = sampleMode ? samplePlatformGrants() : grantsQuery.data;
  // The API has no staff directory, so outside sample mode subjects show as user ids.
  const people = sampleMode ? samplePeople() : [];
  const nameOf = (userId: string) => people.find((p) => p.userId === userId)?.displayName ?? userId;
  const loadError = sampleMode ? null : (switchError ?? (grantsQuery.isError ? accessErrorKey(grantsQuery.error) : null));

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Heading level={1}>{t('admin:access.platform.title')}</Heading>
        <Text tone="secondary">{t('admin:access.platform.lead')}</Text>
      </div>

      {sampleMode ? <Alert tone="info">{t('admin:access.sampleNote')}</Alert> : null}

      {canGrant ? (
        <div>
          <Button
            disabled={sampleMode || grants === undefined}
            onClick={() => {
              setAssignKey((k) => k + 1);
              setAssignOpen(true);
            }}
          >
            {t('admin:access.assign.open')}
          </Button>
        </div>
      ) : null}

      {canRevoke ? <Text tone="secondary">{t('admin:access.platform.revokeNote')}</Text> : null}

      {loadError ? (
        <Alert tone="danger" title={t('admin:access.errors.loadTitle')}>
          {t(`admin:access.errors.${loadError}`)}
        </Alert>
      ) : grants === undefined ? (
        <Text tone="secondary">{t('admin:access.loading')}</Text>
      ) : grants.length === 0 ? (
        <Text tone="secondary">{t('admin:access.platform.empty')}</Text>
      ) : (
        <GrantTable
          caption={t('admin:access.platform.tableCaption')}
          grants={grants}
          members={people}
          onRevoke={canRevoke ? setRevokeTarget : undefined}
          actionsDisabled={sampleMode}
        />
      )}

      <UserAccessLookup opsApi={opsApi} enabled={ready} sampleMode={sampleMode} headingLevel={2} />

      {canGrant && !sampleMode ? (
        <AssignPlatformGrantDialog key={assignKey} open={assignOpen} onOpenChange={setAssignOpen} opsApi={opsApi} />
      ) : null}

      {canRevoke && !sampleMode ? (
        <RevokeGrantDialog
          grant={revokeTarget}
          templateName={revokeTarget ? templateLabel(t, revokeTarget.templateKey) : ''}
          subjectName={revokeTarget ? nameOf(revokeTarget.subjectUserId) : ''}
          onClose={() => setRevokeTarget(null)}
          opsApi={opsApi}
          orgId={null}
        />
      ) : null}
    </div>
  );
}
