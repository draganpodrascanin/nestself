/**
 * Settings: Account (name, language), Security (sessions, authenticator) and
 * Preferences (theme), with the privacy text at the end.
 */
import { useTranslation } from 'react-i18next';
import { Heading, Switch, Text, useTheme } from '@nestself/ui';
import { AccountSettings } from './account-settings';
import { AuthenticatorSection } from './authenticator-section';
import { SessionsList } from './sessions-list';
import type { AccountApi } from './use-account';

export interface SettingsScreenProps {
  authApi: AccountApi;
  sampleMode: boolean;
}

export function SettingsScreen({ authApi, sampleMode }: SettingsScreenProps) {
  const { t } = useTranslation(['workspace', 'auth', 'common']);
  const { theme, setMode } = useTheme();

  return (
    <div className="space-y-10">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:settings.title')}
      </Heading>

      <section aria-labelledby="settings-account" className="space-y-4">
        <Heading level={2} id="settings-account">
          {t('auth:account.sections.account')}
        </Heading>
        <AccountSettings authApi={authApi} sampleMode={sampleMode} />
      </section>

      <section aria-labelledby="settings-security" className="space-y-8">
        <Heading level={2} id="settings-security">
          {t('auth:account.sections.security')}
        </Heading>
        <SessionsList authApi={authApi} sampleMode={sampleMode} />
        <AuthenticatorSection authApi={authApi} sampleMode={sampleMode} />
      </section>

      <section aria-labelledby="settings-preferences" className="space-y-4">
        <Heading level={2} id="settings-preferences">
          {t('auth:account.sections.preferences')}
        </Heading>
        <div className="space-y-3">
          <Heading level={3}>{t('workspace:settings.theme')}</Heading>
          <Switch
            checked={theme.mode === 'dark'}
            onCheckedChange={(checked) => setMode(checked ? 'dark' : 'light')}
          >
            {theme.mode === 'dark' ? t('common:theme.dark') : t('common:theme.light')}
          </Switch>
        </div>
      </section>

      <section aria-labelledby="settings-privacy" className="space-y-3">
        <Heading level={2} id="settings-privacy">
          {t('common:privacy.whoCanSee')}
        </Heading>
        <Text className="text-text-secondary">{t('common:privacy.pointOfUse')}</Text>
      </section>
    </div>
  );
}
