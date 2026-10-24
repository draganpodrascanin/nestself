/**
 * `appointment.no_show_followup`: sent by `calls.no_show_followup` within 48
 * hours when the employee did not join (CALL-07). Asks whether a technical
 * problem got in the way, with a link to report it and, once the booking
 * epic exists, a link to book again. No calendar file.
 */
import {
  composeMail,
  interpolate,
  link,
  paragraph,
  whenValues,
  type AppointmentWindow,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export interface AppointmentNoShowFollowupData {
  appointment: AppointmentWindow;
  /** Where the employee reports a technical problem. */
  reportProblemUrl: string;
  /** Booking page of NS-BOOKING-01; omitted until it exists. */
  bookingUrl?: string;
}

export const messages: Messages<'subject' | 'body' | 'reportAction' | 'bookAction'> = {
  en: {
    subject: 'About your NestSelf session',
    body: 'You did not join the session on {{date}} at {{time}}. If a technical problem kept you from joining, you can report it.',
    reportAction: 'Report a technical problem',
    bookAction: 'Book another session',
  },
  'sr-Latn': {
    subject: 'U vezi sa vašom NestSelf sesijom',
    body: 'Niste se pridružili sesiji {{date}} u {{time}}. Ako vas je u tome sprečio tehnički problem, možete ga prijaviti.',
    reportAction: 'Prijavite tehnički problem',
    bookAction: 'Zakažite novu sesiju',
  },
  'sr-Cyrl': {
    subject: 'У вези са вашом NestSelf сесијом',
    body: 'Нисте се придружили сесији {{date}} у {{time}}. Ако вас је у томе спречио технички проблем, можете га пријавити.',
    reportAction: 'Пријавите технички проблем',
    bookAction: 'Закажите нову сесију',
  },
  hu: {
    subject: 'A NestSelf alkalmával kapcsolatban',
    body: 'Nem csatlakozott a(z) {{date}}, {{time}} időpontra tervezett alkalomhoz. Ha technikai probléma akadályozta ebben, bejelentheti.',
    reportAction: 'Technikai probléma bejelentése',
    bookAction: 'Új alkalom foglalása',
  },
};

export function render(locale: MailLocale, data: AppointmentNoShowFollowupData): RenderedMail {
  const copy = messages[locale];
  return composeMail(locale, copy.subject, [
    paragraph(interpolate(copy.body, whenValues(locale, data.appointment))),
    link(copy.reportAction, data.reportProblemUrl),
    ...(data.bookingUrl ? [link(copy.bookAction, data.bookingUrl)] : []),
  ]);
}
