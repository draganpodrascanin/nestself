import { ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'phosphor-react-native';
import { Screen, Text } from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import type { SupportArea } from '@nestself/contracts';
import { SampleDataBanner } from '@/components/SampleDataBanner';
import { BookingDemo } from '@/components/BookingDemo';

export default function SupportAreaScreen() {
  const { area } = useLocalSearchParams<{ area: SupportArea }>();
  const { t } = useTranslation(['mobile', 'common']);
  const { colors, space } = useTheme();
  const router = useRouter();

  const safeArea = (area ?? 'psychological') as SupportArea;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space[32], gap: space[24] }}
        showsVerticalScrollIndicator={false}
      >
        <SampleDataBanner />

        {/* Back button */}
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

        {/* Area title */}
        <Text role="screenTitle">
          {t(`common:area.${safeArea}`)}
        </Text>

        {/* Area introduction */}
        <Text role="body" tone="secondary">
          {t(`mobile:support.areaIntro.${safeArea}`)}
        </Text>

        {/* Booking demonstration */}
        <BookingDemo />
      </ScrollView>
    </Screen>
  );
}
