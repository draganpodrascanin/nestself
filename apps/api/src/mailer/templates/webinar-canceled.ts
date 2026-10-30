/**
 * `webinar.canceled`: every registered attendee when operations cancel a
 * published webinar (WBN-32). Neutral subject and a `METHOD:CANCEL` calendar
 * file with the registration's UID.
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
  type MailEnvelope,
  type MailLocale,
  type Messages,
  type RenderedMail,
  type WebinarWindow,
} from './shared.js';

export interface WebinarCanceledData {
  registrationId: string;
  webinar: WebinarWindow;
  /** The webinar list in the workspace app. */
  webinarsUrl: string;
  /** Calendar SEQUENCE; defaults to 1, above the confirmation's 0. */
  sequence?: number;
}

export const messages: Messages<'subject' | 'body'> = {
  en: { subject: 'Your NestSelf webinar was canceled', body: 'The webinar on {{date}} at {{time}} was canceled.' },
  'sr-Latn': {
    subject: 'Vaš NestSelf vebinar je otkazan',
    body: 'Vebinar zakazan za {{date}} u {{time}} je otkazan.',
  },
  'sr-Cyrl': {
    subject: 'Ваш NestSelf вебинар је отказан',
    body: 'Вебинар заказан за {{date}} у {{time}} је отказан.',
  },
  hu: {
    subject: 'Az Ön NestSelf webinárja elmarad',
    body: 'A(z) {{date}}, {{time}} időpontra tervezett webinár elmarad.',
  },
};

export function render(locale: MailLocale, data: WebinarCanceledData, envelope: MailEnvelope): RenderedMail {
  const copy = messages[locale];
  const shared = sharedMessages[locale];
  const { webinar } = data;
  const body = interpolate(copy.body, whenValues(locale, webinar));
  return composeMail(
    locale,
    copy.subject,
    [paragraph(body), link(shared.openAction, data.webinarsUrl)],
    [
      calendarAttachment('nestself-webinar.ics', envelope, {
        method: 'CANCEL',
        uid: icsUid('webinar-registration', data.registrationId),
        summary: shared.webinarSummary,
        description: body,
        startsAt: webinar.startsAt,
        endsAt: webinar.endsAt,
        timeZone: webinar.timeZone,
        sequence: data.sequence,
      }),
    ],
  );
}
