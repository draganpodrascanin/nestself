/**
 * `survey_invitation`: an eligible employee at the launch of a survey cycle
 * (spec EMP-01, EMP-03, OPS-01). Names the organization, the short voluntary
 * survey and its closing date; never a question, an answer or a score.
 */
import { composeMail, formatDate, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

export interface SurveyMailData {
  organizationName: string;
  /** ISO instant the cycle closes. */
  closesAt: string;
  /** The organization's IANA time zone, for the closing date. */
  timeZone: string;
  /** Authenticated link to the survey page. */
  surveyUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'openAction'> = {
  en: {
    subject: 'A short survey from {{organizationName}} on NestSelf',
    body: '{{organizationName}} invites you to a short, voluntary survey about your experience at work. It takes about 3 minutes and closes on {{date}}. Your employer sees only aggregate results for groups of at least 10 people.',
    openAction: 'Open the survey',
  },
  'sr-Latn': {
    subject: 'Kratka anketa organizacije {{organizationName}} na NestSelf-u',
    body: '{{organizationName}} vas poziva na kratku, dobrovoljnu anketu o vašem iskustvu na poslu. Traje oko 3 minuta i zatvara se {{date}}. Poslodavac vidi samo zbirne rezultate za grupe od najmanje 10 osoba.',
    openAction: 'Otvorite anketu',
  },
  'sr-Cyrl': {
    subject: 'Кратка анкета организације {{organizationName}} на NestSelf-у',
    body: '{{organizationName}} вас позива на кратку, добровољну анкету о вашем искуству на послу. Траје око 3 минута и затвара се {{date}}. Послодавац види само збирне резултате за групе од најмање 10 особа.',
    openAction: 'Отворите анкету',
  },
  hu: {
    subject: 'Rövid kérdőív a(z) {{organizationName}} szervezettől a NestSelf-en',
    body: 'A(z) {{organizationName}} meghívja Önt egy rövid, önkéntes kérdőívre a munkahelyi tapasztalatairól. Körülbelül 3 percet vesz igénybe, és {{date}} napon zárul. A munkáltatója csak 10 vagy több főből álló csoportok összesített eredményeit látja.',
    openAction: 'A kérdőív megnyitása',
  },
};

export function render(locale: MailLocale, data: SurveyMailData): RenderedMail {
  const copy = messages[locale];
  const values = { organizationName: data.organizationName, date: formatDate(locale, data.closesAt, data.timeZone) };
  return composeMail(locale, interpolate(copy.subject, values), [paragraph(interpolate(copy.body, values)), link(copy.openAction, data.surveyUrl)]);
}
