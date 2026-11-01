/**
 * `review_report_shared`: the reviewer released a report version to the
 * engagement (spec REV-07, OPS-01), to the employer requester. Neutral: a
 * report is available and the link; never a finding.
 */
import { composeMail, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

export interface ReviewReportSharedMailData {
  organizationName: string;
  engagementUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'openAction'> = {
  en: {
    subject: 'A workplace review report is available',
    body: 'The reviewer has shared a report for the workplace review of {{organizationName}}. Sign in to read it; this email contains none of its content.',
    openAction: 'Open the report',
  },
  'sr-Latn': {
    subject: 'Izveštaj o pregledu radnog okruženja je dostupan',
    body: 'Stručnjak je podelio izveštaj o pregledu radnog okruženja organizacije {{organizationName}}. Prijavite se da biste ga pročitali; ova poruka ne sadrži njegov sadržaj.',
    openAction: 'Otvorite izveštaj',
  },
  'sr-Cyrl': {
    subject: 'Извештај о прегледу радног окружења је доступан',
    body: 'Стручњак је поделио извештај о прегледу радног окружења организације {{organizationName}}. Пријавите се да бисте га прочитали; ова порука не садржи његов садржај.',
    openAction: 'Отворите извештај',
  },
  hu: {
    subject: 'Elérhető egy munkahelyi átvilágítási jelentés',
    body: 'Az átvilágító megosztotta a(z) {{organizationName}} munkahelyi átvilágításának jelentését. Jelentkezzen be az elolvasásához; ez a levél nem tartalmazza a jelentés tartalmát.',
    openAction: 'A jelentés megnyitása',
  },
};

export function render(locale: MailLocale, data: ReviewReportSharedMailData): RenderedMail {
  const copy = messages[locale];
  return composeMail(locale, copy.subject, [paragraph(interpolate(copy.body, { organizationName: data.organizationName })), link(copy.openAction, data.engagementUrl)]);
}
