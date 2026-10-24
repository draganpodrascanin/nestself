/**
 * `appointment.canceled`: both participants after a cancellation (CALL-27).
 * Neutral subject, and a `METHOD:CANCEL` calendar file with the same UID as
 * the reminders so calendars remove the entry.
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
  type MailEnvelope,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export interface AppointmentCanceledData {
  appointment: AppointmentWindow;
  /** Link to the appointment page in the recipient's app. */
  appointmentUrl: string;
  /** Calendar SEQUENCE; defaults to 1, above the reminders' 0. */
  sequence?: number;
}

export const messages: Messages<'subject' | 'body'> = {
  en: { subject: 'Your NestSelf session was canceled', body: 'The session on {{date}} at {{time}} was canceled.' },
  'sr-Latn': {
    subject: 'Vaša NestSelf sesija je otkazana',
    body: 'Sesija zakazana za {{date}} u {{time}} je otkazana.',
  },
  'sr-Cyrl': {
    subject: 'Ваша NestSelf сесија је отказана',
    body: 'Сесија заказана за {{date}} у {{time}} је отказана.',
  },
  hu: {
    subject: 'Az Ön NestSelf alkalma elmarad',
    body: 'A(z) {{date}}, {{time}} időpontra tervezett alkalom elmarad.',
  },
};

export function render(locale: MailLocale, data: AppointmentCanceledData, envelope: MailEnvelope): RenderedMail {
  const copy = messages[locale];
  const shared = sharedMessages[locale];
  const { appointment } = data;
  const body = interpolate(copy.body, whenValues(locale, appointment));
  return composeMail(
    locale,
    copy.subject,
    [paragraph(body), link(shared.openAction, data.appointmentUrl)],
    [
      calendarAttachment('nestself-session.ics', envelope, {
        method: 'CANCEL',
        uid: icsUid('appointment', appointment.id),
        summary: shared.sessionSummary,
        description: body,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        timeZone: appointment.timeZone,
        sequence: data.sequence,
      }),
    ],
  );
}
