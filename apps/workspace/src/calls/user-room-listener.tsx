/**
 * Listens on the signed-in user's own room (`user:{userId}`, T-CW-1.9) on
 * every authenticated page:
 * - a follow-up proposal refreshes the appointment lists and the finished
 *   consultation, so a proposal made after the employee left the post-call
 *   screen appears without a reload (CALL-42), and a toast says so;
 * - a reminder fired while the user is online shows a toast (CALL-01
 *   criterion 5, D-CW-26).
 * Renders nothing. A refused or failed connection is silent: the lists still
 * show proposals on load, and the reminder email still goes out.
 */
import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { appointmentKeys } from '@nestself/api-client';
import type { FollowUpProposedEvent } from '@nestself/api-client';
import type { AppointmentRemindPayload } from '@nestself/contracts';
import { useToast } from '@nestself/ui';
import { useAuth } from '../auth';
import { userRoomClient } from './user-room-client';

export function UserRoomListener() {
  const { t, i18n } = useTranslation('calls');
  const { principal } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = principal?.userId ?? null;

  const onFollowUpProposed = useEffectEvent((event: FollowUpProposedEvent) => {
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.detail(event.followUpId) });
    toast.add({ title: t('followUp.employeeTitle'), tone: 'info' });
  });
  const onReminder = useEffectEvent((event: AppointmentRemindPayload) => {
    const time = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(event.startsAt),
    );
    toast.add({ title: t('reminder.toast', { time }), tone: 'info' });
  });

  useEffect(() => {
    if (!userId) return undefined;
    return userRoomClient.subscribe(userId, {
      onFollowUpProposed: (event) => onFollowUpProposed(event),
      onReminder: (event) => onReminder(event),
    });
  }, [userId]);

  return null;
}
