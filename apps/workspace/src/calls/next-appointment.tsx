/**
 * The home page's next appointment (CALL-02): the earliest confirmed
 * appointment that has not ended, from the same list as `/appointments`
 * (the API in API mode, the sample fixtures in sample mode), linked to its
 * page. A failed read says so; a 404 means there is nothing to show yet.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Card, Text } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import { useCategoryLabel, useExpertLabel } from './appointment-parts';
import { useZonedFormat } from './format';
import { mapCallError } from './map-call-error';
import { useAppointmentList } from './use-appointments';

/** Look back far enough to catch a session that is running now. */
const LOOK_BACK_MS = 3 * 60 * 60 * 1000;

export function NextAppointment() {
  const { t } = useTranslation(['calls', 'workspace']);
  const { t: tCalls } = useTranslation('calls');
  const format = useZonedFormat();
  const expertLabel = useExpertLabel();
  const categoryLabel = useCategoryLabel();
  const [now] = useState(() => Date.now());
  const [from] = useState(() => new Date(now - LOOK_BACK_MS).toISOString());
  const list = useAppointmentList({ from });

  if (list.status === 'pending') return <Text className="text-text-secondary">{t('workspace:home.upcoming')}</Text>;
  if (list.status === 'error' && !(list.error instanceof ApiError && list.error.status === 404)) {
    return (
      <Alert tone="warning">
        {t('calls:appointments.nextLoadFailed')} {mapCallError(list.error, tCalls)}
      </Alert>
    );
  }

  const next = list.items
    .filter((item) => item.status === 'confirmed' && Date.parse(item.endsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!next) return <Text className="text-text-secondary">{t('workspace:home.noAppointments')}</Text>;

  const expert = expertLabel(next);
  return (
    <Card className="gap-4 flex flex-col">
      <div className="gap-4 flex items-center">
        <Avatar initials={(expert.name ?? expert.label).slice(0, 1)} name={expert.label} size="md" />
        <div>
          <Text className="font-[var(--font-weight-label)]">
            {expert.name ? t('calls:appointments.withExpert', { name: expert.name }) : expert.label}
          </Text>
          <Text className="type-metadata text-text-secondary">
            {t('calls:appointments.dateTime', {
              date: format.date(next.startsAt, next.timeZone),
              time: format.time(next.startsAt, next.timeZone),
            })}
          </Text>
          <Text className="type-metadata text-text-secondary">{categoryLabel(next.serviceCategory)}</Text>
        </div>
      </div>
      <Link
        to="/appointments/$appointmentId"
        params={{ appointmentId: next.id }}
        className="type-body text-primary underline underline-offset-[0.2em]"
      >
        {t('calls:appointments.openNext')}
      </Link>
    </Card>
  );
}
