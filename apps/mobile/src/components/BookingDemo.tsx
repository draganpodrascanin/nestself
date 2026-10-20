import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Text,
  Card,
  Avatar,
  Button,
  CostBreakdown,
  Divider,
} from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { SAMPLE_BOOKING } from '@nestself/sample-data';
import { formatCurrency } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { CheckCircle } from 'phosphor-react-native';

type Step = 'advisor' | 'time' | 'review' | 'done';

export function BookingDemo() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const { colors, space, radius } = useTheme();
  const [step, setStep] = useState<Step>('advisor');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const locale = i18n.language as Locale;

  const booking = SAMPLE_BOOKING;

  if (step === 'advisor') {
    return (
      <Card>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[12],
          }}
        >
          <Avatar name={booking.advisorName} size={48} />
          <View style={{ flex: 1 }}>
            <Text role="label">{booking.advisorName}</Text>
            <Text role="metadata" tone="secondary">
              {t('common:area.psychological')}
            </Text>
          </View>
        </View>
        <Button
          label={t('common:action.continue')}
          onPress={() => setStep('time')}
        />
      </Card>
    );
  }

  if (step === 'time') {
    return (
      <Card>
        <Text role="sectionTitle">{t('mobile:support.selectTime')}</Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: space[8],
          }}
        >
          {booking.slots.map((slot) => (
            <Pressable
              key={slot}
              onPress={() => setSelectedSlot(slot)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedSlot === slot }}
              accessibilityLabel={slot}
              style={{
                paddingHorizontal: space[16],
                paddingVertical: space[12],
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor:
                  selectedSlot === slot
                    ? colors.primary
                    : colors.borderControl,
                backgroundColor:
                  selectedSlot === slot ? colors.tint : colors.surface,
              }}
            >
              <Text
                role="label"
                style={
                  selectedSlot === slot ? { color: colors.primary } : undefined
                }
              >
                {slot}
              </Text>
            </Pressable>
          ))}
        </View>
        {selectedSlot ? (
          <Button
            label={t('common:action.continue')}
            onPress={() => setStep('review')}
          />
        ) : null}
      </Card>
    );
  }

  if (step === 'review') {
    const feeLabel = t('mobile:support.sessionFee');
    const coversLabel = t('mobile:support.employerCovers');
    const payLabel = t('mobile:support.youPay');

    return (
      <Card>
        <Text role="sectionTitle">{t('mobile:support.review')}</Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[12],
          }}
        >
          <Avatar name={booking.advisorName} size={40} />
          <View style={{ flex: 1 }}>
            <Text role="label">{booking.advisorName}</Text>
            <Text role="metadata" tone="secondary">
              {booking.date} {selectedSlot}
            </Text>
          </View>
        </View>

        <Divider />

        <CostBreakdown
          rows={[
            {
              label: feeLabel,
              amount: formatCurrency(booking.price, booking.currency, locale),
            },
            {
              label: coversLabel,
              amount: formatCurrency(
                booking.employerCovers,
                booking.currency,
                locale,
              ),
            },
            {
              label: payLabel,
              amount: formatCurrency(
                booking.youPay,
                booking.currency,
                locale,
              ),
            },
          ]}
        />

        <Button
          label={t('mobile:support.confirmFor', {
            amount: formatCurrency(booking.youPay, booking.currency, locale),
          })}
          onPress={() => setStep('done')}
        />
      </Card>
    );
  }

  // done
  return (
    <Card>
      <View style={{ alignItems: 'center', gap: space[12] }}>
        <CheckCircle size={48} weight="duotone" color={colors.success} />
        <Text role="sectionTitle" style={{ textAlign: 'center' }}>
          {t('mobile:support.done')}
        </Text>
        <Text role="body" tone="secondary" style={{ textAlign: 'center' }}>
          {t('common:sample.demoNoop')}
        </Text>
        <Button
          variant="secondary"
          label={t('common:action.startAgain')}
          onPress={() => {
            setSelectedSlot(null);
            setStep('advisor');
          }}
        />
      </View>
    </Card>
  );
}
