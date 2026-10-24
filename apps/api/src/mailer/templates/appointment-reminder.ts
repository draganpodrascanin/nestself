/**
 * `appointment.reminder`: 24 hours and 1 hour before a consultation
 * (CALL-01, D-CW-26). Neutral subject "Your NestSelf session", the join link
 * and the calendar file.
 */
import { icsUid } from '../../calendar/ics-generator.js';
import {
  calendarAttachment,
  composeMail,
  interpolate,
  link,
  paragraph,
  sharedMessages,
  whenValues,
  type AppointmentWindow,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export interface AppointmentReminderData {
  appointment: AppointmentWindow;
  /** Authenticated link to the appointment page, where the join button lives. */
  joinUrl: string;
  /** Calendar SEQUENCE; leave unset unless the event changed since the first file. */
  sequence?: number;
}

export const messages: Messages<'subject' | 'body'> = {
  en: { subject: 'Your NestSelf session', body: 'Reminder: session on {{date}} at {{time}}.' },
  'sr-Latn': { subject: 'Vaša NestSelf sesija', body: 'Podsetnik: sesija {{date}} u {{time}}.' },
  'sr-Cyrl': { subject: 'Ваша NestSelf сесија', body: 'Подсетник: сесија {{date}} у {{time}}.' },
  hu: { subject: 'Az Ön NestSelf alkalma', body: 'Emlékeztető: alkalom {{date}}, {{time}}.' },
};

export function render(locale: MailLocale, data: AppointmentReminderData): RenderedMail {
  const copy = messages[locale];
  const shared = sharedMessages[locale];
  const { appointment } = data;
  return composeMail(
    locale,
    copy.subject,
    [paragraph(interpolate(copy.body, whenValues(locale, appointment))), link(shared.joinAction, data.joinUrl)],
    [
      calendarAttachment('nestself-session.ics', {
        method: 'REQUEST',
        uid: icsUid('appointment', appointment.id),
        summary: shared.sessionSummary,
        description: interpolate(shared.joinDescription, { url: data.joinUrl }),
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        timeZone: appointment.timeZone,
        sequence: data.sequence,
      }),
    ],
  );
}
