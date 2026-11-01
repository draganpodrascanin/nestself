import { createFileRoute } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { useAuth } from '../../../../auth';
import { isSampleDataMode } from '../../../../data-source';
import { orgAdminApi } from '../../../../features/access/use-org-admin';
import { RecipientsSettings } from '../../../../features/feedback/recipients-settings';
import { listeningApi } from '../../../../features/listening/listening-api';
import { ListeningSettingsScreen } from '../../../../features/listening/settings-screen';

/** The organization's listening settings, and the feedback recipients for holders of `org.settings` (spec FBK-03). */
export const Route = createFileRoute('/_authenticated/_listening/listening/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const { principal, effectiveActions } = useAuth();
  const canEditRecipients = isSampleDataMode || (principal ? can(principal, 'org.settings', undefined, effectiveActions) : false);
  return (
    <div className="space-y-10">
      <ListeningSettingsScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />
      {canEditRecipients ? <RecipientsSettings listeningApi={listeningApi} adminApi={orgAdminApi} sampleMode={isSampleDataMode} /> : null}
    </div>
  );
}
