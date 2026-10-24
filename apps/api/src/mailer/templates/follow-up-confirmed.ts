/**
 * `appointment.follow_up.confirmed`: expert and employee when a follow-up is
 * confirmed without approval or after the expert picks a suggested window
 * (CALL-36, CALL-37, guidelines 10.5). Carries the calendar file.
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

export interface FollowUpConfirmedData {
  appointment: AppointmentWindow;
  /** Authenticated link to the appointment page in the recipient's app. */
  joinUrl: string;
  sequence?: number;
}

export const messages: Messages<'subject' | 'body'> = {
  en: {
    subject: 'Your follow-up session is confirmed',
    body: 'Your follow-up session on {{date}} at {{time}} is confirmed.',
  },
  'sr-Latn': {
    subject: 'Vaša naredna sesija je potvrđena',
    body: 'Vaša naredna sesija {{date}} u {{time}} je potvrđena.',
  },
  'sr-Cyrl': {
    subject: 'Ваша наредна сесија је потврђена',
    body: 'Ваша наредна сесија {{date}} у {{time}} је потврђена.',
  },
  hu: {
    subject: 'A következő alkalom megerősítve',
    body: 'A következő alkalom időpontja megerősítve: {{date}}, {{time}}.',
  },
};

export function render(locale: MailLocale, data: FollowUpConfirmedData, envelope: MailEnvelope): RenderedMail {
  const copy = messages[locale];
  const shared = sharedMessages[locale];
  const { appointment } = data;
  return composeMail(
    locale,
    copy.subject,
    [paragraph(interpolate(copy.body, whenValues(locale, appointment))), link(shared.joinAction, data.joinUrl)],
    [
      calendarAttachment('nestself-session.ics', envelope, {
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
