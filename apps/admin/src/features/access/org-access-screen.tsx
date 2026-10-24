import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { GrantResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { accessErrorKey } from './access-errors';
import { templateLabel } from './access-labels';
import { AssignOrgTemplateDialog } from './assign-org-template-dialog';
import { GrantTable } from './grant-table';
import { RevokeGrantDialog } from './revoke-grant-dialog';
import { sampleMembers, sampleOrgGrants } from './sample-access';
import { UserAccessLookup } from './user-access-lookup';
import { useOperationsContext, useOrgGrants, useOrgMembers } from './use-ops-admin';

export interface OrgAccessScreenProps {
  opsApi: OpsAdminApi;
  /** The organization from the URL; the server checks the caller may manage it. */
  orgId: string;
  /** Sample mode: fixtures instead of the API, and every mutation disabled. */
  sampleMode: boolean;
}

/**
 * Access management for one organization from the operations workspace
 * (T-2.2, staff side). Grants are assigned organization-wide; org-unit scoping
 * is HR's job in the workspace. Actions are shown by effective action, and
 * the server enforces them again.
 */
export function OrgAccessScreen({ opsApi, orgId, sampleMode }: OrgAccessScreenProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { principal, effectiveActions } = useAuth();
  const { ready, error: switchError } = useOperationsContext(sampleMode);

  const apiOrgId = ready ? orgId : null;
  const grantsQuery = useOrgGrants(opsApi, apiOrgId);
  const membersQuery = useOrgMembers(opsApi, apiOrgId);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignKey, setAssignKey] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<GrantResponse | null>(null);

  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canGrant = allowed('access.grant');
  const canRevoke = allowed('access.revoke');

  const grants = sampleMode ? sampleOrgGrants(orgId) : grantsQuery.data;
  const members = sampleMode ? sampleMembers(orgId) : (membersQuery.data ?? []);
  const loadError = sampleMode ? null : (switchError ?? (grantsQuery.isError ? accessErrorKey(grantsQuery.error) : null));
  // Members only name people: on failure the table still renders with user
  // ids and an alert says what is missing.
  const membersError = !sampleMode && membersQuery.isError ? (accessErrorKey(membersQuery.error) ?? 'unknown') : null;
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.displayName ?? userId;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Heading level={3}>{t('admin:access.org.title')}</Heading>
        <Text tone="secondary">{t('admin:access.org.lead')}</Text>
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

      {membersError ? (
        <Alert tone="danger" title={t('admin:access.errors.membersLoadTitle')}>
          {t(`admin:access.errors.${membersError}`)}
        </Alert>
      ) : null}

      {loadError ? (
        <Alert tone="danger" title={t('admin:access.errors.loadTitle')}>
          {t(`admin:access.errors.${loadError}`)}
        </Alert>
      ) : grants === undefined ? (
        <Text tone="secondary">{t('admin:access.loading')}</Text>
      ) : grants.length === 0 ? (
        <Text tone="secondary">{t('admin:access.empty')}</Text>
      ) : (
        <GrantTable
          caption={t('admin:access.org.tableCaption')}
          grants={grants}
          members={members}
          onRevoke={canRevoke ? setRevokeTarget : undefined}
          actionsDisabled={sampleMode}
        />
      )}

      <UserAccessLookup opsApi={opsApi} enabled={ready} sampleMode={sampleMode} headingLevel={3} />

      {canGrant && !sampleMode ? (
        <AssignOrgTemplateDialog
          key={assignKey}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          opsApi={opsApi}
          orgId={orgId}
          members={members}
        />
      ) : null}

      {canRevoke && !sampleMode ? (
        <RevokeGrantDialog
          grant={revokeTarget}
          templateName={revokeTarget ? templateLabel(t, revokeTarget.templateKey) : ''}
          subjectName={revokeTarget ? nameOf(revokeTarget.subjectUserId) : ''}
          onClose={() => setRevokeTarget(null)}
          opsApi={opsApi}
          orgId={orgId}
        />
      ) : null}
    </div>
  );
}
