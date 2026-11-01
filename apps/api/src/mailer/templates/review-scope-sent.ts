/**
 * `review_scope_sent`: the coordinator sent a scope to accept (spec REV-05).
 * Neutral: the validity date and the link; the price and the terms are read
 * after sign-in by the person with the authority to accept them.
 */
import { composeMail, formatDate, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

export interface ReviewScopeSentMailData {
  organizationName: string;
  validUntil: string;
  timeZone: string;
  requestUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'openAction'> = {
  en: {
    subject: 'A workplace review scope is ready for your decision',
    body: 'NestSelf has sent a scope and terms for the workplace review requested by {{organizationName}}. It is valid until {{date}}. Sign in to read it and accept or decline it.',
    openAction: 'Open the scope',
  },
  'sr-Latn': {
    subject: 'Obim pregleda radnog okruženja čeka vašu odluku',
    body: 'NestSelf je poslao obim i uslove za pregled radnog okruženja koji je zatražila organizacija {{organizationName}}. Važi do {{date}}. Prijavite se da biste ga pročitali i prihvatili ili odbili.',
    openAction: 'Otvorite obim',
  },
  'sr-Cyrl': {
    subject: 'Обим прегледа радног окружења чека вашу одлуку',
    body: 'NestSelf је послао обим и услове за преглед радног окружења који је затражила организација {{organizationName}}. Важи до {{date}}. Пријавите се да бисте га прочитали и прихватили или одбили.',
    openAction: 'Отворите обим',
  },
  hu: {
    subject: 'Egy munkahelyi átvilágítási ajánlat várja a döntését',
    body: 'A NestSelf elküldte a(z) {{organizationName}} által kért munkahelyi átvilágítás terjedelmét és feltételeit. Érvényes: {{date}}. Jelentkezzen be az elolvasásához és az elfogadáshoz vagy elutasításhoz.',
    openAction: 'Az ajánlat megnyitása',
  },
};

export function render(locale: MailLocale, data: ReviewScopeSentMailData): RenderedMail {
  const copy = messages[locale];
  const values = { organizationName: data.organizationName, date: formatDate(locale, data.validUntil, data.timeZone) };
  return composeMail(locale, copy.subject, [paragraph(interpolate(copy.body, values)), link(copy.openAction, data.requestUrl)]);
}
