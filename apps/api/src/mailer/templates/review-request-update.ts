/**
 * `review_request_update`: the employer requester learns that a workplace
 * review request changed state (spec REV-02, REV-03, OPS-01): triaged,
 * information needed, declined or canceled. Neutral: the new status and the
 * link, no reason text and no score.
 */
import { composeMail, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

export interface ReviewRequestUpdateMailData {
  organizationName: string;
  status: string;
  requestUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'openAction'> = {
  en: {
    subject: 'Your workplace review request was updated',
    body: 'The workplace review request of {{organizationName}} has a new status: {{status}}. Sign in to read the details and the next step.',
    openAction: 'Open the request',
  },
  'sr-Latn': {
    subject: 'Vaš zahtev za pregled radnog okruženja je ažuriran',
    body: 'Zahtev za pregled radnog okruženja organizacije {{organizationName}} ima novi status: {{status}}. Prijavite se da biste pročitali detalje i sledeći korak.',
    openAction: 'Otvorite zahtev',
  },
  'sr-Cyrl': {
    subject: 'Ваш захтев за преглед радног окружења је ажуриран',
    body: 'Захтев за преглед радног окружења организације {{organizationName}} има нови статус: {{status}}. Пријавите се да бисте прочитали детаље и следећи корак.',
    openAction: 'Отворите захтев',
  },
  hu: {
    subject: 'A munkahelyi átvilágítási kérése frissült',
    body: 'A(z) {{organizationName}} munkahelyi átvilágítási kérésének új állapota: {{status}}. Jelentkezzen be a részletekért és a következő lépésért.',
    openAction: 'A kérés megnyitása',
  },
};

export function render(locale: MailLocale, data: ReviewRequestUpdateMailData): RenderedMail {
  const copy = messages[locale];
  const values = { organizationName: data.organizationName, status: data.status };
  return composeMail(locale, copy.subject, [paragraph(interpolate(copy.body, values)), link(copy.openAction, data.requestUrl)]);
}
