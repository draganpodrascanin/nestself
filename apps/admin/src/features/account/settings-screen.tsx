/**
 * Settings: Account (name, language), Security (sessions, authenticator) and
 * Preferences (appearance), with the privacy text at the end.
 */
import { useTranslation } from 'react-i18next';
import { Heading, Text, cn, useTheme } from '@nestself/ui';
import { AccountSettings } from './account-settings';
import { AuthenticatorSection } from './authenticator-section';
import { SessionsList } from './sessions-list';
import type { AccountApi } from './use-account';

export interface SettingsScreenProps {
  authApi: AccountApi;
  sampleMode: boolean;
}

export function SettingsScreen({ authApi, sampleMode }: SettingsScreenProps) {
  const { t } = useTranslation(['admin', 'auth', 'common']);
  const { theme, setMode } = useTheme();

  const modeButton = (mode: 'light' | 'dark', label: string) => (
    <button
      type="button"
      aria-pressed={theme.mode === mode}
      onClick={() => setMode(mode)}
      className={cn(
        'rounded-control px-4 py-2 border border-border-control type-body',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        theme.mode === mode ? 'bg-primary text-on-primary' : 'bg-surface text-text-secondary',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-10">
      <Heading level={1}>{t('admin:settings.title')}</Heading>

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
          <Heading level={3}>{t('admin:settings.appearance')}</Heading>
          <div className="flex gap-2">
            {modeButton('light', t('admin:settings.modeLight'))}
            {modeButton('dark', t('admin:settings.modeDark'))}
          </div>
        </div>
        <Text className="text-text-secondary">{t('common:privacy.pointOfUse')}</Text>
      </section>
    </div>
  );
}
