/**
 * The user room listener (T-CW-1.9, CALL-42, CALL-01): a follow-up proposal
 * refreshes the appointment queries and shows a toast; a reminder shows a
 * toast with the start in the appointment's own time zone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resourcesFor } from '@nestself/i18n';
import { appointmentKeys } from '@nestself/api-client';
import type { UserRoomHandlers } from '@nestself/api-client';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../auth/auth-context';
import type { AuthContextValue } from '../auth';

const room = vi.hoisted(() => ({ userId: null as string | null, handlers: null as UserRoomHandlers | null }));
vi.mock('./user-room-client', () => ({
  userRoomClient: {
    subscribe: (userId: string, handlers: UserRoomHandlers) => {
      room.userId = userId;
      room.handlers = handlers;
      return () => {
        room.handlers = null;
      };
    },
  },
}));

import { UserRoomListener } from './user-room-listener';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'calls']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function renderListener() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const auth = { principal: { userId: 'user_jovan' }, effectiveActions: [] } as unknown as AuthContextValue;
  render(
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <ToastProvider labels={{ dismiss: 'Dismiss' }}>
            <UserRoomListener />
          </ToastProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { invalidate };
}

describe('UserRoomListener', () => {
  afterEach(() => cleanup());

  it('subscribes to the signed-in user’s room', () => {
    renderListener();
    expect(room.userId).toBe('user_jovan');
  });

  it('refreshes the appointment queries and shows a toast when a follow-up is proposed', async () => {
    const { invalidate } = renderListener();
    act(() =>
      room.handlers?.onFollowUpProposed?.({
        appointmentId: 'appt_1',
        followUpId: 'appt_2',
        startsAt: '2030-01-20T09:00:00.000Z',
        durationMinutes: 50,
      }),
    );
    expect(await screen.findByText(testI18n.t('calls:followUp.employeeTitle'))).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: appointmentKeys.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: appointmentKeys.detail('appt_2') });
  });

  it('shows a reminder with the start in the appointment’s time zone', async () => {
    renderListener();
    // 09:00 UTC is 10:00 in Belgrade and 04:00 in New York.
    act(() =>
      room.handlers?.onReminder?.({ appointmentId: 'appt_2', startsAt: '2030-01-20T09:00:00.000Z', offsetMinutes: 60, timeZone: 'Europe/Belgrade' }),
    );
    expect(await screen.findByText(/^Reminder: your NestSelf session starts at 10:00/)).toBeInTheDocument();
    act(() =>
      room.handlers?.onReminder?.({ appointmentId: 'appt_3', startsAt: '2030-01-20T09:00:00.000Z', offsetMinutes: 60, timeZone: 'America/New_York' }),
    );
    expect(await screen.findByText(/^Reminder: your NestSelf session starts at (04:00|4:00)/)).toBeInTheDocument();
  });
});
