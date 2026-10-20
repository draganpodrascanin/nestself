import { View, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'phosphor-react-native';
import { Screen, Text, Card } from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { locales, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { modes } from '@nestself/tokens';
import { changeLocale } from '@/i18n';
import { SampleDataBanner } from '@/components/SampleDataBanner';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const { colors, space, radius, mode, setMode } = useTheme();
  const router = useRouter();
  const currentLocale = i18n.language as Locale;

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

        <Text role="screenTitle">{t('mobile:settings.title')}</Text>

        {/* Language selection */}
        <Card>
          <Text role="sectionTitle">{t('mobile:settings.language')}</Text>
          <View style={{ gap: space[8] }}>
            {locales.map((loc) => {
              const isActive = currentLocale === loc;
              return (
                <Pressable
                  key={loc}
                  onPress={() => void changeLocale(loc)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={localeMeta[loc].nativeName}
                  style={{
                    paddingVertical: space[12],
                    paddingHorizontal: space[16],
                    borderRadius: radius.control,
                    borderWidth: 1,
                    borderColor: isActive
                      ? colors.primary
                      : colors.borderControl,
                    backgroundColor: isActive ? colors.tint : colors.surface,
                  }}
                >
                  <Text
                    role="label"
                    style={isActive ? { color: colors.primary } : undefined}
                  >
                    {localeMeta[loc].nativeName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Appearance / Mode selection */}
        <Card>
          <Text role="sectionTitle">{t('mobile:settings.appearance')}</Text>
          <View style={{ flexDirection: 'row', gap: space[8] }}>
            {modes.map((m) => {
              const isActive = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={t(`common:theme.${m}`)}
                  style={{
                    flex: 1,
                    paddingVertical: space[12],
                    borderRadius: radius.control,
                    borderWidth: 1,
                    borderColor: isActive
                      ? colors.primary
                      : colors.borderControl,
                    backgroundColor: isActive ? colors.tint : colors.surface,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    role="label"
                    style={isActive ? { color: colors.primary } : undefined}
                  >
                    {t(`common:theme.${m}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
