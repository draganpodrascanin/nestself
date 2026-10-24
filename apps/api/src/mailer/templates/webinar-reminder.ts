/**
 * `webinar.reminder`: 24 hours and 1 hour before a webinar the employee is
 * registered for (WBN-05, D-CW-26). Neutral subject, the recording notice,
 * the join link and the calendar file with the registration's UID.
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
  type MailLocale,
  type Messages,
  type RenderedMail,
  type WebinarWindow,
} from './shared.js';

export interface WebinarReminderData {
  registrationId: string;
  webinar: WebinarWindow;
  joinUrl: string;
  sequence?: number;
}

export const messages: Messages<'subject' | 'body'> = {
  en: { subject: 'Your NestSelf webinar', body: 'Reminder: webinar on {{date}} at {{time}}.' },
  'sr-Latn': { subject: 'Vaš NestSelf vebinar', body: 'Podsetnik: vebinar {{date}} u {{time}}.' },
  'sr-Cyrl': { subject: 'Ваш NestSelf вебинар', body: 'Подсетник: вебинар {{date}} у {{time}}.' },
  hu: { subject: 'Az Ön NestSelf webinárja', body: 'Emlékeztető: webinár {{date}}, {{time}}.' },
};

export function render(locale: MailLocale, data: WebinarReminderData): RenderedMail {
  const copy = messages[locale];
  const shared = sharedMessages[locale];
  const { webinar } = data;
  return composeMail(
    locale,
    copy.subject,
    [
      paragraph(interpolate(copy.body, whenValues(locale, webinar))),
      paragraph(shared.recordingNotice),
      link(shared.joinAction, data.joinUrl),
    ],
    [
      calendarAttachment('nestself-webinar.ics', {
        method: 'REQUEST',
        uid: icsUid('webinar-registration', data.registrationId),
        summary: shared.webinarSummary,
        description: interpolate(shared.joinDescription, { url: data.joinUrl }),
        startsAt: webinar.startsAt,
        endsAt: webinar.endsAt,
        timeZone: webinar.timeZone,
        sequence: data.sequence,
      }),
    ],
  );
}
