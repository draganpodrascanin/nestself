/**
 * The admin user room listener (T-CW-1.9): the employee's suggested times
 * refresh the follow-up page and show a toast; a reminder shows a toast with
 * the start in the appointment's own time zone.
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
  const auth = { principal: { userId: 'user_milica' }, effectiveActions: [] } as unknown as AuthContextValue;
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

describe('admin UserRoomListener', () => {
  afterEach(() => cleanup());

  it('refreshes the follow-up and shows a toast when the employee suggests other times', async () => {
    const { invalidate } = renderListener();
    expect(room.userId).toBe('user_milica');
    act(() =>
      room.handlers?.onTimesSuggested?.({
        appointmentId: 'appt_1',
        followUpId: 'appt_2',
        windows: [{ startsAt: '2030-01-21T09:00:00.000Z', endsAt: '2030-01-21T12:00:00.000Z' }],
      }),
    );
    expect(await screen.findByText(testI18n.t('calls:followUp.pickTitle'))).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: appointmentKeys.detail('appt_2') });
  });

  it('shows a reminder with the start in the appointment’s time zone', async () => {
    renderListener();
    act(() =>
      room.handlers?.onReminder?.({ appointmentId: 'appt_2', startsAt: '2030-01-20T09:00:00.000Z', offsetMinutes: 1440, timeZone: 'Europe/Belgrade' }),
    );
    expect(await screen.findByText(/^Reminder: your NestSelf session starts at 10:00/)).toBeInTheDocument();
  });
});
