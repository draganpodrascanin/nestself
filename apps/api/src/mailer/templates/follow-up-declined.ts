/**
 * `appointment.follow_up.declined`: the expert, when the employee declines a
 * proposed follow-up (CALL-38, guidelines 10.5). No calendar file.
 */
import {
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

export interface FollowUpDeclinedData {
  appointment: AppointmentWindow;
  /** The appointment page in the expert's app. */
  appointmentUrl: string;
}

export const messages: Messages<'subject' | 'body'> = {
  en: {
    subject: 'The follow-up session was declined',
    body: 'The follow-up session proposed for {{date}} at {{time}} was declined.',
  },
  'sr-Latn': {
    subject: 'Naredna sesija je odbijena',
    body: 'Naredna sesija predložena za {{date}} u {{time}} je odbijena.',
  },
  'sr-Cyrl': {
    subject: 'Наредна сесија је одбијена',
    body: 'Наредна сесија предложена за {{date}} у {{time}} је одбијена.',
  },
  hu: {
    subject: 'A következő alkalmat elutasították',
    body: 'A(z) {{date}}, {{time}} időpontra javasolt következő alkalmat elutasították.',
  },
};

export function render(locale: MailLocale, data: FollowUpDeclinedData): RenderedMail {
  const copy = messages[locale];
  return composeMail(locale, copy.subject, [
    paragraph(interpolate(copy.body, whenValues(locale, data.appointment))),
    link(sharedMessages[locale].openAction, data.appointmentUrl),
  ]);
}
