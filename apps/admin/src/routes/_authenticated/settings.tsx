import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Select, Text } from '@nestself/ui';
import { useTheme } from '@nestself/ui';
import { locales, localeMeta } from '@nestself/i18n';

function SettingsPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const { theme, setMode } = useTheme();

  const handleLocaleChange = (value: string | null) => {
    if (!value) return;
    void i18n.changeLanguage(value);
    try {
      localStorage.setItem('nestself-locale', value);
    } catch {
      // Storage may be blocked
    }
  };

  const localeOptions = locales.map((loc) => ({
    value: loc,
    label: localeMeta[loc].nativeName,
  }));

  return (
    <div className="max-w-lg">
      <Heading level={1}>{t('admin:settings.title')}</Heading>

      <div className="mt-8 flex flex-col gap-8">
        <div>
          <Heading level={2}>{t('admin:settings.locale')}</Heading>
          <Select
            options={localeOptions}
            value={i18n.resolvedLanguage ?? 'en'}
            onValueChange={handleLocaleChange}
            className="mt-3"
          />
        </div>

        <div>
          <Heading level={2}>{t('admin:settings.appearance')}</Heading>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setMode('light')}
              className={`rounded-control px-4 py-2 border border-border-control type-body ${theme.mode === 'light' ? 'bg-primary text-on-primary' : 'bg-surface text-text-secondary'}`}
            >
              {t('admin:settings.modeLight')}
            </button>
            <button
              type="button"
              onClick={() => setMode('dark')}
              className={`rounded-control px-4 py-2 border border-border-control type-body ${theme.mode === 'dark' ? 'bg-primary text-on-primary' : 'bg-surface text-text-secondary'}`}
            >
              {t('admin:settings.modeDark')}
            </button>
          </div>
        </div>

        <div>
          <Text className="text-text-secondary">{t('common:privacy.pointOfUse')}</Text>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
});
