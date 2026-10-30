/**
 * Building blocks of the email templates (T-CW-1.3, D-CW-26).
 *
 * Templates are TypeScript modules with the four locales inline, because
 * `apps/api` does not depend on `@nestself/i18n`. Wording that already exists
 * in `packages/i18n/locales/<locale>/calls.json` is copied verbatim; the
 * `sr-Cyrl` strings are the output of the i18n package's transliterator
 * (`packages/i18n/scripts/transliterate-core.mjs`) run on the `sr-Latn`
 * strings, never typed by hand. The Serbian and Hungarian copy are drafts
 * pending native speaker review, like the catalogs.
 *
 * Dates use `Intl.DateTimeFormat` in the appointment's own time zone
 * (D-CW-32, no date library). Bodies are plain paragraphs and links: no
 * colours or images, and no service category, specialty or wellbeing topic.
 */
import { type Appointment, type Locale } from '@nestself/contracts';
import { generateIcs, type IcsEvent, type IcsMethod } from '../../calendar/ics-generator.js';

export type MailLocale = Locale;

export interface MailAttachment {
  filename: string;
  /** Full media type with parameters, for example `text/calendar; charset=UTF-8; method=REQUEST`. */
  contentType: string;
  /** UTF-8 text content. */
  content: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

/**
 * Sender and recipient of the email being rendered. The calendar file names
 * the sender as `ORGANIZER` and the recipient as the `ATTENDEE` (RFC 5546).
 */
export interface MailEnvelope {
  from: string;
  to: string;
}

/** Copy of one template: the same keys in every locale (checked by the tests). */
export type Messages<K extends string> = Record<Locale, Record<K, string>>;

/** The fields of an appointment the templates read (the D-CW-02 seam). */
export type AppointmentWindow = Pick<Appointment, 'id' | 'startsAt' | 'endsAt' | 'timeZone'>;

/** A webinar occurrence's schedule; the zone is the occurrence's (default `Europe/Belgrade`, D-CW-38). */
export interface WebinarWindow {
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

/** `Intl` locale for each app locale (same as `localeMeta.intl` in `@nestself/i18n`). */
const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-GB',
  'sr-Latn': 'sr-Latn-RS',
  'sr-Cyrl': 'sr-Cyrl-RS',
  hu: 'hu-HU',
};

export const sharedMessages: Messages<
  'joinAction' | 'openAction' | 'sessionSummary' | 'webinarSummary' | 'joinDescription' | 'recordingNotice'
> = {
  en: {
    joinAction: 'Open NestSelf to join',
    openAction: 'Open NestSelf',
    sessionSummary: 'NestSelf session',
    webinarSummary: 'NestSelf webinar',
    joinDescription: 'Sign in to NestSelf to join: {{url}}',
    recordingNotice: 'This webinar is recorded. Only the presenters are on the recording.',
  },
  'sr-Latn': {
    joinAction: 'Otvorite NestSelf da biste se pridružili',
    openAction: 'Otvorite NestSelf',
    sessionSummary: 'NestSelf sesija',
    webinarSummary: 'NestSelf vebinar',
    joinDescription: 'Prijavite se na NestSelf da biste se pridružili: {{url}}',
    recordingNotice: 'Ovaj vebinar se snima. Na snimku su samo predavači.',
  },
  'sr-Cyrl': {
    joinAction: 'Отворите NestSelf да бисте се придружили',
    openAction: 'Отворите NestSelf',
    sessionSummary: 'NestSelf сесија',
    webinarSummary: 'NestSelf вебинар',
    joinDescription: 'Пријавите се на NestSelf да бисте се придружили: {{url}}',
    recordingNotice: 'Овај вебинар се снима. На снимку су само предавачи.',
  },
  hu: {
    joinAction: 'Nyissa meg a NestSelf alkalmazást a csatlakozáshoz',
    openAction: 'A NestSelf megnyitása',
    sessionSummary: 'NestSelf alkalom',
    webinarSummary: 'NestSelf webinár',
    joinDescription: 'Jelentkezzen be a NestSelf alkalmazásba a csatlakozáshoz: {{url}}',
    recordingNotice: 'Ez a webinár felvételre kerül. A felvételen csak az előadók szerepelnek.',
  },
};

/** Replaces every `{{name}}`; a placeholder without a value is a programming error. */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing value for {{${name}}}`);
    return value;
  });
}

function instant(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${iso}`);
  return date;
}

/** Long date in the locale and zone, for example "Monday, 2 November 2026". */
export function formatDate(locale: Locale, iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: 'full', timeZone }).format(instant(iso));
}

/** 24-hour time with the zone abbreviation, for example "10:00 CET". */
export function formatTime(locale: Locale, iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
    timeZone,
  }).format(instant(iso));
}

/** `{{date}}` and `{{time}}` of a scheduled window. */
export function whenValues(locale: Locale, window: { startsAt: string; timeZone: string }): {
  date: string;
  time: string;
} {
  return {
    date: formatDate(locale, window.startsAt, window.timeZone),
    time: formatTime(locale, window.startsAt, window.timeZone),
  };
}

export function durationMinutes(window: { startsAt: string; endsAt: string }): number {
  return Math.round((instant(window.endsAt).getTime() - instant(window.startsAt).getTime()) / 60_000);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function assertHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Mail links must be absolute http or https URLs');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Mail links must be absolute http or https URLs');
  }
  return url;
}

export type MailBlock = { paragraph: string } | { link: { label: string; url: string } };

export function paragraph(text: string): MailBlock {
  return { paragraph: text };
}

export function link(label: string, url: string): MailBlock {
  return { link: { label, url: assertHttpUrl(url) } };
}

/**
 * Assembles subject, plain text and HTML from paragraphs and links. Values
 * interpolated into the subject lose their line breaks; HTML escapes every
 * text and attribute.
 */
export function composeMail(
  locale: Locale,
  subject: string,
  blocks: MailBlock[],
  attachments: MailAttachment[] = [],
): RenderedMail {
  const cleanSubject = subject.replace(/[\r\n]+/g, ' ').trim();
  const text = blocks
    .map((block) => ('paragraph' in block ? block.paragraph : `${block.link.label}: ${block.link.url}`))
    .join('\n\n');
  const body = blocks
    .map((block) =>
      'paragraph' in block
        ? `<p>${escapeHtml(block.paragraph)}</p>`
        : `<p><a href="${escapeHtml(block.link.url)}">${escapeHtml(block.link.label)}</a></p>`,
    )
    .join('\n');
  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(cleanSubject)}</title>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
  return attachments.length > 0
    ? { subject: cleanSubject, text: `${text}\n`, html: `${html}\n`, attachments }
    : { subject: cleanSubject, text: `${text}\n`, html: `${html}\n` };
}

/**
 * The calendar file of D-CW-26 as a `text/calendar` part, organised by the
 * sender for the recipient. `REQUEST` defaults to `SEQUENCE:0`; `CANCEL`
 * defaults to 1 so it supersedes the request.
 */
export function calendarAttachment(
  filename: string,
  envelope: MailEnvelope,
  event: Omit<IcsEvent, 'dtstart' | 'dtend' | 'method' | 'organizer' | 'attendee'> & {
    method: IcsMethod;
    startsAt: string;
    endsAt: string;
  },
): MailAttachment {
  const { startsAt, endsAt, method, sequence, ...rest } = event;
  const content = generateIcs({
    ...rest,
    organizer: envelope.from,
    attendee: envelope.to,
    method,
    sequence: sequence ?? (method === 'CANCEL' ? 1 : 0),
    dtstart: instant(startsAt),
    dtend: instant(endsAt),
  });
  return { filename, contentType: `text/calendar; charset=UTF-8; method=${method}`, content };
}
