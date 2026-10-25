import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { GrantResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { accessErrorKey } from './access-errors';
import type { AccessErrorKey } from './access-errors';
import { grantStatus, templateLabel } from './access-labels';
import { AssignTemplateDialog } from './assign-template-dialog';
import { DelegateGrantDialog } from './delegate-grant-dialog';
import { EffectiveAccessPanel } from './effective-access-panel';
import { GrantTable } from './grant-table';
import { RevokeGrantDialog } from './revoke-grant-dialog';
import { TransferOwnershipDialog } from './transfer-ownership-dialog';
import { sampleGrants, sampleMembers, sampleOrgUnits } from './sample-access';
import { useGrants, useMembers, useOrgUnits } from './use-org-admin';

export interface AccessScreenProps {
  adminApi: OrgAdminApi;
  /** Sample mode: fixtures instead of the API, and every mutation disabled. */
  sampleMode: boolean;
}

/**
 * Access management for an organization (T-2.2). The organization is the
 * signed-in user's single active membership, never a URL or body value; the
 * screen moves the session into that organization's context before loading.
 * Actions are shown by effective action, and the server enforces them again.
 */
export function AccessScreen({ adminApi, sampleMode }: AccessScreenProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { principal, effectiveActions, switchContext } = useAuth();

  const activeMemberships = principal?.memberships.filter((m) => m.status === 'ACTIVE') ?? [];
  const orgId = activeMemberships.length === 1 ? activeMemberships[0]!.orgId : null;
  const inOrgContext =
    orgId !== null && principal?.context.kind === 'organization' && principal.context.orgId === orgId;

  const switchRequested = useRef(false);
  const [switchError, setSwitchError] = useState<AccessErrorKey | null>(null);
  useEffect(() => {
    // Once this mount has seen the organization context it never switches
    // again: a later choice in the header context picker stands.
    if (inOrgContext) switchRequested.current = true;
    if (sampleMode || orgId === null || inOrgContext || switchRequested.current) return;
    switchRequested.current = true;
    switchContext({ kind: 'organization', orgId }).catch((err: unknown) => {
      setSwitchError(accessErrorKey(err) ?? 'unknown');
    });
  }, [sampleMode, orgId, inOrgContext, switchContext]);

  const apiOrgId = !sampleMode && inOrgContext ? orgId : null;
  const grantsQuery = useGrants(adminApi, apiOrgId);
  const membersQuery = useMembers(adminApi, apiOrgId);
  const orgUnitsQuery = useOrgUnits(adminApi, apiOrgId);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignKey, setAssignKey] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<GrantResponse | null>(null);
  const [delegateParent, setDelegateParent] = useState<GrantResponse | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferKey, setTransferKey] = useState(0);

  const allowed = (action: string) =>
    principal ? can(principal, action, undefined, effectiveActions) : false;
  const canGrant = allowed('access.grant');
  const canRevoke = allowed('access.revoke');
  const canDelegate = allowed('access.delegate');

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('workspace:access.title')}</Heading>
      <Text tone="secondary">{t('workspace:access.lead')}</Text>
    </div>
  );

  if (!principal || orgId === null) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">{t('workspace:access.noOrganization')}</Alert>
      </div>
    );
  }

  const grants = sampleMode ? sampleGrants(orgId) : grantsQuery.data;
  const members = sampleMode ? sampleMembers(orgId) : (membersQuery.data ?? []);
  const orgUnits = sampleMode ? sampleOrgUnits(orgId) : (orgUnitsQuery.data ?? []);
  const loadError = sampleMode ? null : switchError ?? (grantsQuery.isError ? accessErrorKey(grantsQuery.error) : null);
  // Members and org units only name things: on failure the table still renders
  // (with user ids and a generic unit label) and an alert says what is missing.
  const membersError = !sampleMode && membersQuery.isError ? accessErrorKey(membersQuery.error) ?? 'unknown' : null;
  const orgUnitsError = !sampleMode && orgUnitsQuery.isError ? accessErrorKey(orgUnitsQuery.error) ?? 'unknown' : null;
  // Only the current owner may transfer: the server checks again and answers
  // `forbidden` otherwise. A revoked, expired or not yet valid owner grant
  // gives no actions, so it does not count.
  const isOwner = (grants ?? []).some(
    (g) =>
      g.templateKey === 'employer_owner' &&
      g.subjectUserId === principal.userId &&
      grantStatus(g) === 'active',
  );
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.displayName ?? userId;

  return (
    <div className="space-y-8">
      {header}

      {sampleMode ? <Alert tone="info">{t('workspace:access.sampleNote')}</Alert> : null}

      {canGrant || isOwner ? (
        <div className="flex flex-wrap gap-3">
          {canGrant ? (
            <Button
              disabled={sampleMode || grants === undefined}
              onClick={() => {
                setAssignKey((k) => k + 1);
                setAssignOpen(true);
              }}
            >
              {t('workspace:access.assign.open')}
            </Button>
          ) : null}
          {isOwner ? (
            <Button
              variant="secondary"
              disabled={sampleMode}
              onClick={() => {
                setTransferKey((k) => k + 1);
                setTransferOpen(true);
              }}
            >
              {t('workspace:access.transfer.open')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {membersError ? (
        <Alert tone="danger" title={t('workspace:access.errors.membersLoadTitle')}>
          {t(`workspace:access.errors.${membersError}`)}
        </Alert>
      ) : null}

      {orgUnitsError ? (
        <Alert tone="danger" title={t('workspace:access.errors.orgUnitsLoadTitle')}>
          {t(`workspace:access.errors.${orgUnitsError}`)}
        </Alert>
      ) : null}

      {loadError ? (
        <Alert tone="danger" title={t('workspace:access.errors.loadTitle')}>
          {t(`workspace:access.errors.${loadError}`)}
        </Alert>
      ) : grants === undefined ? (
        <Text tone="secondary">{t('workspace:access.loading')}</Text>
      ) : grants.length === 0 ? (
        <Text tone="secondary">{t('workspace:access.empty')}</Text>
      ) : (
        <GrantTable
          grants={grants}
          members={members}
          orgUnits={orgUnits}
          currentUserId={principal.userId}
          canRevoke={canRevoke}
          canDelegate={canDelegate}
          actionsDisabled={sampleMode}
          onRevoke={setRevokeTarget}
          onDelegate={setDelegateParent}
        />
      )}

      {grants !== undefined ? (
        <EffectiveAccessPanel adminApi={adminApi} orgId={orgId} members={members} sampleMode={sampleMode} />
      ) : null}

      {canGrant && !sampleMode ? (
        <AssignTemplateDialog
          key={assignKey}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          adminApi={adminApi}
          orgId={orgId}
          members={members}
          orgUnits={orgUnits}
        />
      ) : null}

      {canRevoke && !sampleMode ? (
        <RevokeGrantDialog
          grant={revokeTarget}
          templateName={revokeTarget ? templateLabel(t, revokeTarget.templateKey) : ''}
          subjectName={revokeTarget ? nameOf(revokeTarget.subjectUserId) : ''}
          onClose={() => setRevokeTarget(null)}
          adminApi={adminApi}
          orgId={orgId}
        />
      ) : null}

      {isOwner && !sampleMode ? (
        <TransferOwnershipDialog
          key={transferKey}
          open={transferOpen}
          onOpenChange={setTransferOpen}
          adminApi={adminApi}
          orgId={orgId}
          members={members.filter((m) => m.userId !== principal.userId)}
        />
      ) : null}

      {canDelegate && !sampleMode ? (
        <DelegateGrantDialog
          parent={delegateParent}
          onClose={() => setDelegateParent(null)}
          adminApi={adminApi}
          orgId={orgId}
          members={members.filter((m) => m.userId !== principal.userId)}
        />
      ) : null}
    </div>
  );
}
