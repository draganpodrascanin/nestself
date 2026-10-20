import { Alert } from '@nestself/ui-native';
import { useTranslation } from 'react-i18next';

/**
 * Warning banner shown when the app is running in sample/development mode.
 * Uses the Alert component with warning tone from ui-native.
 */
export function SampleDataBanner() {
  const { t } = useTranslation('common');

  if (!__DEV__) return null;

  return <Alert tone="warning" message={t('sample.banner')} />;
}
