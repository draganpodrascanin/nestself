import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Screen,
  Text,
  ListRow,
  CategoryIcon,
} from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { supportAreas } from '@nestself/contracts';
import { SampleDataBanner } from '@/components/SampleDataBanner';
import { categoryIconMap, areaToCategory } from '@/lib/categories';

export default function SupportScreen() {
  const { t } = useTranslation('mobile');
  const { colors, space, radius } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space[32], gap: space[24] }}
        showsVerticalScrollIndicator={false}
      >
        <SampleDataBanner />

        <Text role="screenTitle">{t('support.title')}</Text>

        <View style={{ gap: space[8] }}>
          <Text role="label" tone="secondary">
            {t('support.categories')}
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
                <CategoryIcon
                  category={areaToCategory[area]}
                  iconMap={categoryIconMap}
                  size={28}
                />
                <View style={{ flex: 1 }}>
                  <Text role="body">{t(`support.${area}`)}</Text>
                </View>
              </ListRow>
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
