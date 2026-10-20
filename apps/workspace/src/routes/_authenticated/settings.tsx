import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Text, Select, useTheme } from '@nestself/ui';
import { locales, localeMeta } from '@nestself/i18n';
import { Switch } from '@nestself/ui';

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { theme, setMode } = useTheme();

  const localeOptions = locales.map((loc) => ({
    value: loc,
    label: localeMeta[loc].nativeName,
  }));

  const handleLocaleChange = (value: string | null) => {
    if (value) {
      void i18n.changeLanguage(value);
    }
  };

  return (
    <div className="space-y-8">
      <Heading level={1} typeRole="screenTitle">
        {t('workspace:settings.title')}
      </Heading>

      {/* Language setting */}
      <section className="space-y-3">
        <Heading level={2} typeRole="sectionTitle">
          {t('workspace:settings.language')}
        </Heading>
        <Select
          options={localeOptions}
          value={i18n.resolvedLanguage ?? 'en'}
          onValueChange={handleLocaleChange}
        />
      </section>

      {/* Appearance setting */}
      <section className="space-y-3">
        <Heading level={2} typeRole="sectionTitle">
          {t('workspace:settings.theme')}
        </Heading>
        <div className="flex items-center gap-3">
          <Switch
            checked={theme.mode === 'dark'}
            onCheckedChange={(checked) => setMode(checked ? 'dark' : 'light')}
          />
          <Text className="type-metadata">
            {theme.mode === 'dark' ? t('common:theme.dark') : t('common:theme.light')}
          </Text>
        </div>
      </section>

      {/* Privacy text */}
      <section className="space-y-3">
        <Heading level={2} typeRole="sectionTitle">
          {t('common:privacy.whoCanSee')}
        </Heading>
        <Text className="text-text-secondary">
          {t('common:privacy.pointOfUse')}
        </Text>
      </section>
    </div>
  );
}
