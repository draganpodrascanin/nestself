import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Avatar, Card, ListRow, CategoryIcon } from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { SAMPLE_BOOKING } from '@nestself/sample-data';
import { supportAreas } from '@nestself/contracts';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '@/auth/use-auth';
import { SampleDataBanner } from '@/components/SampleDataBanner';
import { categoryIconMap, areaToCategory } from '@/lib/categories';

export default function HomeScreen() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const { colors, space, radius } = useTheme();
  const { principal } = useAuth();
  const router = useRouter();

  const displayName = principal?.displayName ?? '';
  const appointmentDate = new Date(SAMPLE_BOOKING.appointmentAt);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space[32], gap: space[24] }}
        showsVerticalScrollIndicator={false}
      >
        <SampleDataBanner />

        {/* Header row: wordmark + avatar */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text role="label" tone="default">
            {t('common:brand.name')}
          </Text>
          <Avatar name={displayName} size={40} />
        </View>

        {/* Greeting */}
        <Text role="screenTitle">
          {t('mobile:home.greeting', { name: displayName.split(' ')[0] })}
        </Text>

        {/* Next appointment card */}
        <View style={{ gap: space[8] }}>
          <Text role="label" tone="secondary">
            {t('mobile:home.upcoming')}
          </Text>
          <Card>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[12],
              }}
            >
              <Avatar name={SAMPLE_BOOKING.advisorName} size={40} />
              <View style={{ flex: 1 }}>
                <Text role="label">{SAMPLE_BOOKING.advisorName}</Text>
                <Text role="metadata" tone="secondary">
                  {formatDateTime(appointmentDate, i18n.language as Locale)}
                </Text>
              </View>
            </View>
            <Text role="metadata" tone="secondary">
              {t('common:area.psychological')}
            </Text>
          </Card>
        </View>

        {/* Support area categories */}
        <View style={{ gap: space[8] }}>
          <Text role="label" tone="secondary">
            {t('mobile:support.categories')}
          </Text>
          <View
            style={{
              borderRadius: radius.card,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: colors.borderSubtle,
            }}
          >
            {supportAreas.map((area, index) => (
              <ListRow
                key={area}
                onPress={() => router.push(`/support/${area}`)}
                style={
                  index < supportAreas.length - 1
                    ? { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }
                    : undefined
                }
              >
                <CategoryIcon category={areaToCategory[area]} iconMap={categoryIconMap} size={28} />
                <Text role="body" style={{ flex: 1 }}>
                  {t(`mobile:support.${area}`)}
                </Text>
              </ListRow>
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
