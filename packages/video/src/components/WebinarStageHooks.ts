/**
 * Hooks shared by the webinar components: translated action errors (error
 * visibility rule), change announcements for the `LiveRegion` (WBN-15) and
 * the short local time.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useControllerSlice } from '../hooks/useControllerSlice';
import { useWebinarStage } from '../hooks/useWebinarStage';
import type { CallSessionControllerApi } from '../types';
import { webinarErrorMessage } from '../webinar/errors';
import type { WebinarActionErrorLike, WebinarClientApi } from '../webinar/types';

/** Translated messages for coded action errors, plus an already translated external error. */
export function useErrorMessages(external: string | null | undefined, ...coded: Array<WebinarActionErrorLike | null | undefined>): string[] {
  const { t } = useTranslation('calls');
  const messages = [external, ...coded.map((error) => webinarErrorMessage(error, t))].filter((entry): entry is string => !!entry);
  return [...new Set(messages)];
}

/**
 * The latest announcement for a value that changes: `describe` turns a change
 * into a sentence (or null for none). Adjusts state while rendering, not in
 * an effect. Each announcement gets a new id so a repeated sentence is read again.
 */
export function useChangeAnnouncement<T>(value: T, describe: (previous: T, next: T) => string | null): { id: number; text: string } {
  const [previous, setPrevious] = useState(value);
  const [announcement, setAnnouncement] = useState({ id: 0, text: '' });
  if (!Object.is(previous, value)) {
    const text = describe(previous, value);
    setPrevious(value);
    if (text) setAnnouncement({ id: announcement.id + 1, text });
  }
  return announcement;
}

/** `14:05` in the viewer's locale. */
export function useShortTime(): (iso: string | null) => string {
  const { i18n } = useTranslation('calls');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return (iso) => {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
    } catch {
      return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso));
    }
  };
}

/**
 * The browser blocked the microphone while this attendee has the floor: the
 * coded `microphone_unavailable` error, shown as
 * `webinar.errors.microphoneUnavailable` by the dialog and the controls.
 */
export function useMicrophoneBlocked(
  client: WebinarClientApi,
  controller: Pick<CallSessionControllerApi, 'getSnapshot' | 'subscribe'>,
): WebinarActionErrorLike | null {
  const stage = useWebinarStage(client);
  const { permissions } = useControllerSlice(controller, 'devices');
  const blocked = stage.myFloor.status === 'given' && (permissions.microphone === 'denied' || permissions.microphone === 'error');
  return blocked ? MICROPHONE_BLOCKED : null;
}

const MICROPHONE_BLOCKED: WebinarActionErrorLike = { code: 'microphone_unavailable', action: 'floor.audio' };
