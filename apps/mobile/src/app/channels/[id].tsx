import { ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChatCircleText } from 'phosphor-react-native';
import { Screen, Text, StatusBlock } from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { SampleDataBanner } from '@/components/SampleDataBanner';

export default function ChannelScreen() {
  const { id: _id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['mobile', 'common']);
  const { colors, space } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space[32], gap: space[24] }}
        showsVerticalScrollIndicator={false}
      >
        <SampleDataBanner />

        <Pressable
          onPress={() => router.back()}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[8],
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common:nav.back')}
        >
          <ArrowLeft size={20} weight="regular" color={colors.text} />
          <Text role="label">{t('common:nav.back')}</Text>
        </Pressable>

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
