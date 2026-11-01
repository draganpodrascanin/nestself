/**
 * `feedback_case_update`: something changed on a feedback case the recipient
 * is part of (spec FBK-02): a reply, a status or a resolution. The same
 * neutral notice goes to a reporter and to a handler; the link differs. No
 * content, no state, no names.
 */
import { composeMail, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

export interface FeedbackUpdateMailData {
  pseudonym: string;
  caseUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'openAction'> = {
  en: {
    subject: 'Update on feedback case {{pseudonym}}',
    body: 'There is a new message or a status change on a feedback case you are part of ({{pseudonym}}). Sign in to read it; this email contains no case content.',
    openAction: 'Open the case',
  },
  'sr-Latn': {
    subject: 'Novosti o slučaju povratne informacije {{pseudonym}}',
    body: 'Postoji nova poruka ili promena statusa u slučaju povratne informacije u kojem učestvujete ({{pseudonym}}). Prijavite se da biste je pročitali; ova poruka ne sadrži sadržaj slučaja.',
    openAction: 'Otvorite slučaj',
  },
  'sr-Cyrl': {
    subject: 'Новости о случају повратне информације {{pseudonym}}',
    body: 'Постоји нова порука или промена статуса у случају повратне информације у којем учествујете ({{pseudonym}}). Пријавите се да бисте је прочитали; ова порука не садржи садржај случаја.',
    openAction: 'Отворите случај',
  },
  hu: {
    subject: 'Frissítés a(z) {{pseudonym}} visszajelzési esetről',
    body: 'Új üzenet vagy állapotváltozás történt egy visszajelzési esetben, amelynek Ön is részese ({{pseudonym}}). Jelentkezzen be az elolvasásához; ez a levél nem tartalmazza az eset tartalmát.',
    openAction: 'Az eset megnyitása',
  },
};

export function render(locale: MailLocale, data: FeedbackUpdateMailData): RenderedMail {
  const copy = messages[locale];
  const values = { pseudonym: data.pseudonym };
  return composeMail(locale, interpolate(copy.subject, values), [paragraph(interpolate(copy.body, values)), link(copy.openAction, data.caseUrl)]);
}
