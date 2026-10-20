import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Text, Field, Select, Switch, useTheme } from '@nestself/ui';
import { locales, localeMeta } from '@nestself/i18n';

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
        <Field label={t('workspace:settings.language')}>
          <Select
            options={localeOptions}
            value={i18n.resolvedLanguage ?? 'en'}
            onValueChange={handleLocaleChange}
          />
        </Field>
      </section>

      {/* Appearance setting */}
      <section className="space-y-3">
        <Heading level={2} typeRole="sectionTitle">
          {t('workspace:settings.theme')}
        </Heading>
        <Switch
          checked={theme.mode === 'dark'}
          onCheckedChange={(checked) => setMode(checked ? 'dark' : 'light')}
        >
          {theme.mode === 'dark' ? t('common:theme.dark') : t('common:theme.light')}
        </Switch>
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
