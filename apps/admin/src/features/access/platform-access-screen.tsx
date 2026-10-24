import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { accessErrorKey } from './access-errors';
import { AssignPlatformGrantDialog } from './assign-platform-grant-dialog';
import { GrantTable } from './grant-table';
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
 * own scope. The operations API has no revoke route for these, so the table
 * is read-only and a note says so.
 */
export function PlatformAccessScreen({ opsApi, sampleMode }: PlatformAccessScreenProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { principal, effectiveActions } = useAuth();
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const grantsQuery = usePlatformGrants(opsApi, ready);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignKey, setAssignKey] = useState(0);

  const canGrant = principal ? can(principal, 'access.grant', undefined, effectiveActions) : false;

  const grants = sampleMode ? samplePlatformGrants() : grantsQuery.data;
  // The API has no staff directory, so outside sample mode subjects show as user ids.
  const people = sampleMode ? samplePeople() : [];
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

      <Text tone="secondary">{t('admin:access.platform.readOnlyNote')}</Text>

      {loadError ? (
        <Alert tone="danger" title={t('admin:access.errors.loadTitle')}>
          {t(`admin:access.errors.${loadError}`)}
        </Alert>
      ) : grants === undefined ? (
        <Text tone="secondary">{t('admin:access.loading')}</Text>
      ) : grants.length === 0 ? (
        <Text tone="secondary">{t('admin:access.platform.empty')}</Text>
      ) : (
        <GrantTable caption={t('admin:access.platform.tableCaption')} grants={grants} members={people} />
      )}

      <UserAccessLookup opsApi={opsApi} enabled={ready} sampleMode={sampleMode} headingLevel={2} />

      {canGrant && !sampleMode ? (
        <AssignPlatformGrantDialog key={assignKey} open={assignOpen} onOpenChange={setAssignOpen} opsApi={opsApi} />
      ) : null}
    </div>
  );
}
