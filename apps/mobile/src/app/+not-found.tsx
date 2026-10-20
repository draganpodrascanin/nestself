import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Warning } from 'phosphor-react-native';
import { Screen, StatusBlock } from '@nestself/ui-native';

export default function NotFoundScreen() {
  const { t } = useTranslation(['mobile', 'common']);
  const router = useRouter();

  return (
    <Screen>
      <StatusBlock
        state="EmptyState"
        icon={Warning}
        heading={t('notFound.title')}
        body={t('notFound.body')}
        action={{
          label: t('common:nav.home'),
          onPress: () => router.replace('/'),
          variant: 'primary',
        }}
      />
    </Screen>
  );
}
