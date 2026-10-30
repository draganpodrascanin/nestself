/**
 * `webinar.recorded_notice`: the presenters, when the recording of their
 * webinar is ready for review before the replay handoff (guidelines 10.5,
 * D-CW-34). No title or topic and no calendar file.
 */
import {
  composeMail,
  interpolate,
  link,
  paragraph,
  whenValues,
  type MailLocale,
  type Messages,
  type RenderedMail,
  type WebinarWindow,
} from './shared.js';

export interface WebinarRecordedNoticeData {
  webinar: WebinarWindow;
  /** The recording review page in the admin app. */
  reviewUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'reviewAction'> = {
  en: {
    subject: 'Your webinar recording is ready for review',
    body: 'The recording of the webinar on {{date}} at {{time}} is ready for your review.',
    reviewAction: 'Open NestSelf to review it',
  },
  'sr-Latn': {
    subject: 'Snimak vašeg vebinara je spreman za pregled',
    body: 'Snimak vebinara održanog {{date}} u {{time}} spreman je za vaš pregled.',
    reviewAction: 'Otvorite NestSelf da biste ga pregledali',
  },
  'sr-Cyrl': {
    subject: 'Снимак вашег вебинара је спреман за преглед',
    body: 'Снимак вебинара одржаног {{date}} у {{time}} спреман је за ваш преглед.',
    reviewAction: 'Отворите NestSelf да бисте га прегледали',
  },
  hu: {
    subject: 'A webinárja felvétele áttekintésre kész',
    body: 'A(z) {{date}}, {{time}} időpontban tartott webinár felvétele áttekintésre kész.',
    reviewAction: 'Nyissa meg a NestSelf alkalmazást az áttekintéshez',
  },
};

export function render(locale: MailLocale, data: WebinarRecordedNoticeData): RenderedMail {
  const copy = messages[locale];
  return composeMail(locale, copy.subject, [
    paragraph(interpolate(copy.body, whenValues(locale, data.webinar))),
    link(copy.reviewAction, data.reviewUrl),
  ]);
}
