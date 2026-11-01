/**
 * `feedback_case_update`: something changed on a feedback case the recipient
 * is part of (spec FBK-02): a reply, a status or a resolution. The same
 * neutral notice goes to a reporter and to a handler; the link differs (the
 * handler's opens the case, the reporter's their cases page). No content, no
 * state, no names and no pseudonym: a mailbox the employer hosts must not join
 * an account to a case (spec PRI-03).
 */
import { composeMail, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

export interface FeedbackUpdateMailData {
  caseUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'openAction'> = {
  en: {
    subject: 'Update on a feedback case',
    body: 'There is a new message or a status change on a feedback case you are part of. Sign in to read it; this email contains no case content.',
    openAction: 'Open the case',
  },
  'sr-Latn': {
    subject: 'Novosti o slučaju povratne informacije',
    body: 'Postoji nova poruka ili promena statusa u slučaju povratne informacije u kojem učestvujete. Prijavite se da biste je pročitali; ova poruka ne sadrži sadržaj slučaja.',
    openAction: 'Otvorite slučaj',
  },
  'sr-Cyrl': {
    subject: 'Новости о случају повратне информације',
    body: 'Постоји нова порука или промена статуса у случају повратне информације у којем учествујете. Пријавите се да бисте је прочитали; ова порука не садржи садржај случаја.',
    openAction: 'Отворите случај',
  },
  hu: {
    subject: 'Frissítés egy visszajelzési esetről',
    body: 'Új üzenet vagy állapotváltozás történt egy visszajelzési esetben, amelynek Ön is részese. Jelentkezzen be az elolvasásához; ez a levél nem tartalmazza az eset tartalmát.',
    openAction: 'Az eset megnyitása',
  },
};

export function render(locale: MailLocale, data: FeedbackUpdateMailData): RenderedMail {
  const copy = messages[locale];
  return composeMail(locale, copy.subject, [paragraph(copy.body), link(copy.openAction, data.caseUrl)]);
}
