/**
 * `webinar.registration`: the confirmation after registering for a webinar
 * (WBN-04, D-CW-26, D-CW-34). Neutral subject "Your NestSelf webinar", no
 * title or topic, the recording notice, the join link and the calendar file
 * keyed by the registration.
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

export interface WebinarRegistrationData {
  /** The calendar UID is per registration, so unregistering can cancel it. */
  registrationId: string;
  webinar: WebinarWindow;
  /** Authenticated link to the webinar page. */
  joinUrl: string;
  sequence?: number;
}

export const messages: Messages<'subject' | 'body'> = {
  en: {
    subject: 'Your NestSelf webinar',
    body: 'You are registered for a NestSelf webinar on {{date}} at {{time}}.',
  },
  'sr-Latn': {
    subject: 'Vaš NestSelf vebinar',
    body: 'Prijavljeni ste za NestSelf vebinar {{date}} u {{time}}.',
  },
  'sr-Cyrl': {
    subject: 'Ваш NestSelf вебинар',
    body: 'Пријављени сте за NestSelf вебинар {{date}} у {{time}}.',
  },
  hu: {
    subject: 'Az Ön NestSelf webinárja',
    body: 'Sikeresen regisztrált egy NestSelf webinárra: {{date}}, {{time}}.',
  },
};

export function render(locale: MailLocale, data: WebinarRegistrationData): RenderedMail {
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
