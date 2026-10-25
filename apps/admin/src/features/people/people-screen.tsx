import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Heading, Tab, TabList, TabPanel, Tabs, Text } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { useOperationsContext } from '../access/use-ops-admin';
import { InvitationsPanel } from './invitations-panel';
import { MembersPanel } from './members-panel';
import { sampleInvitations, sampleMemberItems } from './sample-people';

export interface OpsPeopleScreenProps {
  opsApi: OpsAdminApi;
  /** The organization from the URL; the server checks the caller may manage it. */
  orgId: string;
  /** Sample mode: fixtures instead of the API, and every mutation disabled. */
  sampleMode: boolean;
}

/**
 * People of one organization from the operations workspace: members (filter,
 * end) and pending invitations (invite, import, revoke) through the
 * `/ops/orgs/:orgId/*` mirrors. Actions are shown by effective action; the
 * server enforces them again.
 */
export function OpsPeopleScreen({ opsApi, orgId, sampleMode }: OpsPeopleScreenProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { principal, effectiveActions } = useAuth();
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canList = allowed('client.configure');
  const canEnd = allowed('people.deactivate');
  const canOnboard = allowed('people.onboard');
  const canImport = allowed('people.import');
  const showInvitations = canOnboard || canImport;
  const apiOrgId = ready ? orgId : null;
  const [tab, setTab] = useState(canList ? 'members' : 'invitations');

  const header = (
    <div className="space-y-2">
      <Heading level={3}>{t('admin:people.title')}</Heading>
      <Text tone="secondary">{t('admin:people.lead')}</Text>
    </div>
  );

  if (!sampleMode && switchError) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title={t('admin:people.errors.loadTitle')}>
          {t(`admin:access.errors.${switchError}`)}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}

      {sampleMode ? <Alert tone="info">{t('admin:people.sampleNote')}</Alert> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabList label={t('admin:people.tabs.label')}>
          {canList ? <Tab value="members">{t('admin:people.tabs.members')}</Tab> : null}
          {showInvitations ? <Tab value="invitations">{t('admin:people.tabs.invitations')}</Tab> : null}
        </TabList>
        {canList ? (
          <TabPanel value="members">
            <MembersPanel
              opsApi={opsApi}
              orgId={orgId}
              apiOrgId={apiOrgId}
              sampleMode={sampleMode}
              sampleMembers={sampleMode ? sampleMemberItems(orgId) : []}
              currentUserId={principal?.userId ?? ''}
              canEnd={canEnd}
            />
          </TabPanel>
        ) : null}
        {showInvitations ? (
          <TabPanel value="invitations">
            <InvitationsPanel
              opsApi={opsApi}
              orgId={orgId}
              apiOrgId={apiOrgId}
              sampleMode={sampleMode}
              sampleInvitations={sampleMode ? sampleInvitations(orgId) : []}
              canOnboard={canOnboard}
              canImport={canImport}
            />
          </TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}
