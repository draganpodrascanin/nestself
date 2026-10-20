import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChatCircleText } from 'phosphor-react-native';
import { Screen, Text, StatusBlock } from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { SampleDataBanner } from '@/components/SampleDataBanner';

export default function MessagesScreen() {
  const { t } = useTranslation('mobile');
  const { space } = useTheme();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space[32], gap: space[24] }}
        showsVerticalScrollIndicator={false}
      >
        <SampleDataBanner />

        <Text role="screenTitle">{t('messages.title')}</Text>

        <StatusBlock
          state="EmptyState"
          icon={ChatCircleText}
          heading={t('messages.noConversations')}
          body={t('messages.noConversationsBody')}
        />
      </ScrollView>
    </Screen>
  );
}
