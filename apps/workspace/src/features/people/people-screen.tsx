import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Heading, Tab, TabList, TabPanel, Tabs, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { InvitationsPanel } from './invitations-panel';
import { MembersPanel } from './members-panel';
import { peopleErrorKey } from './people-errors';
import { sampleInvitations, sampleMembers, sampleOrgUnits } from './sample-people';
import { useOrgContext } from './use-org-context';
import { useOrgUnitList } from '../org/use-org-units';

export interface PeopleScreenProps {
  adminApi: OrgAdminApi;
  /** Sample mode: fixtures instead of the API, and every mutation disabled. */
  sampleMode: boolean;
}

/**
 * HR people management: members (filter, move, end) and pending invitations
 * (invite, import, revoke). The organization is the signed-in user's single
 * active membership. Actions are shown by effective action; the server
 * enforces them again.
 */
export function PeopleScreen({ adminApi, sampleMode }: PeopleScreenProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { principal, effectiveActions } = useAuth();
  const { orgId, needsChoice, apiOrgId, switchError } = useOrgContext(sampleMode);
  const orgUnitsQuery = useOrgUnitList(adminApi, apiOrgId);
  const [tab, setTab] = useState('members');

  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canMove = allowed('people.move');
  const canEnd = allowed('people.deactivate');
  const canInvite = allowed('people.invite');
  const canImport = allowed('people.import');

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('workspace:people.title')}</Heading>
      <Text tone="secondary">{t('workspace:people.lead')}</Text>
    </div>
  );

  if (!principal || orgId === null) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">
          {t(needsChoice ? 'workspace:people.chooseOrganization' : 'workspace:people.noOrganization')}
        </Alert>
      </div>
    );
  }

  if (!sampleMode && switchError) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title={t('workspace:people.errors.loadTitle')}>
          {t(`workspace:people.errors.${peopleErrorKey(switchError) ?? 'unknown'}`)}
        </Alert>
      </div>
    );
  }

  const orgUnits = sampleMode ? sampleOrgUnits(orgId) : (orgUnitsQuery.data ?? []);
  const orgUnitsError = !sampleMode && orgUnitsQuery.isError ? (peopleErrorKey(orgUnitsQuery.error) ?? 'unknown') : null;
  const showInvitations = canInvite || canImport;

  return (
    <div className="space-y-8">
      {header}

      {sampleMode ? <Alert tone="info">{t('workspace:people.sampleNote')}</Alert> : null}

      {orgUnitsError ? (
        <Alert tone="danger" title={t('workspace:people.errors.orgUnitsLoadTitle')}>
          {t(`workspace:people.errors.${orgUnitsError}`)}
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabList label={t('workspace:people.tabs.label')}>
          <Tab value="members">{t('workspace:people.tabs.members')}</Tab>
          {showInvitations ? <Tab value="invitations">{t('workspace:people.tabs.invitations')}</Tab> : null}
        </TabList>
        <TabPanel value="members">
          <MembersPanel
            adminApi={adminApi}
            orgId={orgId}
            apiOrgId={apiOrgId}
            sampleMode={sampleMode}
            sampleMembers={sampleMode ? sampleMembers(orgId) : []}
            orgUnits={orgUnits}
            currentUserId={principal.userId}
            canMove={canMove}
            canEnd={canEnd}
          />
        </TabPanel>
        {showInvitations ? (
          <TabPanel value="invitations">
            <InvitationsPanel
              adminApi={adminApi}
              orgId={orgId}
              apiOrgId={apiOrgId}
              sampleMode={sampleMode}
              sampleInvitations={sampleMode ? sampleInvitations(orgId) : []}
              orgUnits={orgUnits}
              canInvite={canInvite}
              canImport={canImport}
            />
          </TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}
