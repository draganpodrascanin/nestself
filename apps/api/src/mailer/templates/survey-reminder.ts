/**
 * `survey_reminder`: a still-eligible non-submitter while the cycle is open,
 * at most twice per cycle (spec EMP-03). Neutral: the closing date and the
 * link, nothing about the person's state beyond "not yet answered".
 */
import { composeMail, formatDate, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';
import type { SurveyMailData } from './survey-invitation.js';

export const messages: Messages<'subject' | 'body' | 'openAction'> = {
  en: {
    subject: 'Reminder: the {{organizationName}} survey closes on {{date}}',
    body: 'The short, voluntary survey from {{organizationName}} is still open until {{date}}. It takes about 3 minutes. If you have decided not to take part, no action is needed.',
    openAction: 'Open the survey',
  },
  'sr-Latn': {
    subject: 'Podsetnik: anketa organizacije {{organizationName}} zatvara se {{date}}',
    body: 'Kratka, dobrovoljna anketa organizacije {{organizationName}} otvorena je do {{date}}. Traje oko 3 minuta. Ako ste odlučili da ne učestvujete, ništa ne treba da uradite.',
    openAction: 'Otvorite anketu',
  },
  'sr-Cyrl': {
    subject: 'Подсетник: анкета организације {{organizationName}} затвара се {{date}}',
    body: 'Кратка, добровољна анкета организације {{organizationName}} отворена је до {{date}}. Траје око 3 минута. Ако сте одлучили да не учествујете, ништа не треба да урадите.',
    openAction: 'Отворите анкету',
  },
  hu: {
    subject: 'Emlékeztető: a(z) {{organizationName}} kérdőíve {{date}} napon zárul',
    body: 'A(z) {{organizationName}} rövid, önkéntes kérdőíve még {{date}} napig nyitva áll. Körülbelül 3 percet vesz igénybe. Ha úgy döntött, hogy nem vesz részt, nincs teendője.',
    openAction: 'A kérdőív megnyitása',
  },
};

export function render(locale: MailLocale, data: SurveyMailData): RenderedMail {
  const copy = messages[locale];
  const values = { organizationName: data.organizationName, date: formatDate(locale, data.closesAt, data.timeZone) };
  return composeMail(locale, interpolate(copy.subject, values), [paragraph(interpolate(copy.body, values)), link(copy.openAction, data.surveyUrl)]);
}
