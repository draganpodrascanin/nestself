import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CalendarCheck } from 'phosphor-react-native';
import { Screen, Text, StatusBlock } from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { SampleDataBanner } from '@/components/SampleDataBanner';

export default function AppointmentsScreen() {
  const { t } = useTranslation('mobile');
  const { space } = useTheme();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space[32], gap: space[24] }}
        showsVerticalScrollIndicator={false}
      >
        <SampleDataBanner />

        <Text role="screenTitle">{t('appointments.title')}</Text>

        <StatusBlock
          state="EmptyState"
          icon={CalendarCheck}
          heading={t('appointments.noUpcoming')}
          body={t('appointments.noPast')}
        />
      </ScrollView>
    </Screen>
  );
}
