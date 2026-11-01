/**
 * `feedback_case_assigned`: a handler now owns a feedback case (spec FBK-01,
 * FBK-03, FBK-04): on creation, reassignment and escalation, to that handler
 * only. The pseudonym, the response target and the link; no category, no
 * content, nothing about who raised it.
 */
import { composeMail, formatDate, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

export interface FeedbackAssignedMailData {
  pseudonym: string;
  /** The response target, or null once the case has none. */
  dueAt: string | null;
  timeZone: string;
  caseUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'due' | 'openAction'> = {
  en: {
    subject: 'A feedback case was assigned to you ({{pseudonym}})',
    body: 'A case from the organizational feedback channel ({{pseudonym}}) is now in your inbox. Sign in to read it; this email contains no case content.',
    due: 'The response target is {{date}}.',
    openAction: 'Open the case',
  },
  'sr-Latn': {
    subject: 'Dodeljen vam je slučaj povratne informacije ({{pseudonym}})',
    body: 'Slučaj iz kanala za povratne informacije zaposlenih ({{pseudonym}}) sada je u vašem sandučetu. Prijavite se da biste ga pročitali; ova poruka ne sadrži sadržaj slučaja.',
    due: 'Ciljni rok za odgovor je {{date}}.',
    openAction: 'Otvorite slučaj',
  },
  'sr-Cyrl': {
    subject: 'Додељен вам је случај повратне информације ({{pseudonym}})',
    body: 'Случај из канала за повратне информације запослених ({{pseudonym}}) сада је у вашем сандучету. Пријавите се да бисте га прочитали; ова порука не садржи садржај случаја.',
    due: 'Циљни рок за одговор је {{date}}.',
    openAction: 'Отворите случај',
  },
  hu: {
    subject: 'Egy visszajelzési esetet rendeltek Önhöz ({{pseudonym}})',
    body: 'A munkavállalói visszajelzési csatorna egy esete ({{pseudonym}}) most az Ön postafiókjában van. Jelentkezzen be az elolvasásához; ez a levél nem tartalmazza az eset tartalmát.',
    due: 'A válaszadási célhatáridő: {{date}}.',
    openAction: 'Az eset megnyitása',
  },
};

export function render(locale: MailLocale, data: FeedbackAssignedMailData): RenderedMail {
  const copy = messages[locale];
  const values = { pseudonym: data.pseudonym };
  const blocks = [paragraph(interpolate(copy.body, values))];
  if (data.dueAt) blocks.push(paragraph(interpolate(copy.due, { date: formatDate(locale, data.dueAt, data.timeZone) })));
  blocks.push(link(copy.openAction, data.caseUrl));
  return composeMail(locale, interpolate(copy.subject, values), blocks);
}
