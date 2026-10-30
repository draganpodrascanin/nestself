/**
 * Listens on the signed-in expert's own room (`user:{userId}`, T-CW-1.9) on
 * every authenticated page of the admin app:
 * - the employee suggested other times for a follow-up: its page and the
 *   lists refresh, so the windows to pick from appear without a reload, and
 *   a toast says so (CALL-37);
 * - the employee declined a proposed follow-up: a toast says so and the
 *   consultation and the follow-up refresh (CALL-38);
 * - a reminder fired while the expert is online shows a toast with the start
 *   in the appointment's own time zone (CALL-01 criterion 5, D-CW-26).
 * Renders nothing. A refused or failed connection is silent: the pages still
 * load the current state, and the reminder email still goes out.
 */
import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { appointmentKeys } from '@nestself/api-client';
import type { AppointmentRemindPayload, FollowUpDeclinedPayload, TimesSuggestedPayload } from '@nestself/contracts';
import { useToast } from '@nestself/ui';
import { useAuth } from '../auth';
import { useZonedFormat } from './format';
import { userRoomClient } from './user-room-client';

export function UserRoomListener() {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const { principal } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = principal?.userId ?? null;

  const onTimesSuggested = useEffectEvent((event: TimesSuggestedPayload) => {
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.detail(event.followUpId) });
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    toast.add({ title: t('followUp.pickTitle'), tone: 'info' });
  });
  const onFollowUpDeclined = useEffectEvent((event: FollowUpDeclinedPayload) => {
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.detail(event.appointmentId) });
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.detail(event.followUpId) });
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    toast.add({ title: t('followUp.declinedToast'), tone: 'info' });
  });
  const onReminder = useEffectEvent((event: AppointmentRemindPayload) => {
    toast.add({ title: t('reminder.toast', { time: format.time(event.startsAt, event.timeZone) }), tone: 'info' });
  });

  useEffect(() => {
    if (!userId) return undefined;
    return userRoomClient.subscribe(userId, {
      onTimesSuggested: (event) => onTimesSuggested(event),
      onFollowUpDeclined: (event) => onFollowUpDeclined(event),
      onReminder: (event) => onReminder(event),
    });
  }, [userId]);

  return null;
}
