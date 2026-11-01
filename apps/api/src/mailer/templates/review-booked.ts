/**
 * `review_booked`: the review meeting is confirmed (spec REV-06, D-EL-12), to
 * the employer participant and the reviewer, with a calendar file. The
 * organization's name, the time in its zone and the link; no results.
 */
import { icsUid } from '../../calendar/ics-generator.js';
import {
  calendarAttachment,
  composeMail,
  interpolate,
  link,
  paragraph,
  whenValues,
  type MailEnvelope,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export interface ReviewBookedMailData {
  organizationName: string;
  appointment: { id: string; startsAt: string; endsAt: string; timeZone: string };
  engagementUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'summary' | 'openAction'> = {
  en: {
    subject: 'Workplace review meeting confirmed: {{date}}, {{time}}',
    body: 'The workplace review meeting for {{organizationName}} is confirmed for {{date}} at {{time}} ({{timeZone}}). The calendar file is attached; the engagement page has the scope and the shared materials.',
    summary: 'NestSelf workplace review',
    openAction: 'Open the engagement',
  },
  'sr-Latn': {
    subject: 'Sastanak za pregled radnog okruženja potvrđen: {{date}}, {{time}}',
    body: 'Sastanak za pregled radnog okruženja organizacije {{organizationName}} potvrđen je za {{date}} u {{time}} ({{timeZone}}). Kalendarski fajl je u prilogu; stranica angažmana sadrži obim i podeljene materijale.',
    summary: 'NestSelf pregled radnog okruženja',
    openAction: 'Otvorite angažman',
  },
  'sr-Cyrl': {
    subject: 'Састанак за преглед радног окружења потврђен: {{date}}, {{time}}',
    body: 'Састанак за преглед радног окружења организације {{organizationName}} потврђен је за {{date}} у {{time}} ({{timeZone}}). Календарски фајл је у прилогу; страница ангажмана садржи обим и подељене материјале.',
    summary: 'NestSelf преглед радног окружења',
    openAction: 'Отворите ангажман',
  },
  hu: {
    subject: 'Munkahelyi átvilágítási találkozó megerősítve: {{date}}, {{time}}',
    body: 'A(z) {{organizationName}} munkahelyi átvilágítási találkozója megerősítve: {{date}}, {{time}} ({{timeZone}}). A naptárfájl csatolva; a megbízás oldalán található a terjedelem és a megosztott anyagok.',
    summary: 'NestSelf munkahelyi átvilágítás',
    openAction: 'A megbízás megnyitása',
  },
};

export function render(locale: MailLocale, data: ReviewBookedMailData, envelope: MailEnvelope): RenderedMail {
  const copy = messages[locale];
  const when = whenValues(locale, data.appointment);
  const values = { ...when, organizationName: data.organizationName, timeZone: data.appointment.timeZone };
  return composeMail(
    locale,
    interpolate(copy.subject, values),
    [paragraph(interpolate(copy.body, values)), link(copy.openAction, data.engagementUrl)],
    [
      calendarAttachment('nestself-workplace-review.ics', envelope, {
        method: 'REQUEST',
        uid: icsUid('appointment', data.appointment.id),
        summary: copy.summary,
        description: data.engagementUrl,
        startsAt: data.appointment.startsAt,
        endsAt: data.appointment.endsAt,
        timeZone: data.appointment.timeZone,
      }),
    ],
  );
}
