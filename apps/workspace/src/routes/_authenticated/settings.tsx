import { createFileRoute } from '@tanstack/react-router';
import { SettingsScreen } from '../../features/account/settings-screen';
import { accountApi } from '../../features/account/use-account';
import { isSampleDataMode } from '../../data-source';

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  return <SettingsScreen authApi={accountApi} sampleMode={isSampleDataMode} />;
}
