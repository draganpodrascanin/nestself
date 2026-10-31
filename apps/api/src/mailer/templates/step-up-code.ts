/**
 * `step_up_code`: the one-time code NestSelf mails for the step-up of a
 * federated user, whom Cognito cannot send one (auth phase 4, spec 5.3).
 *
 * Tone follows the Cognito CustomMessage trigger
 * (`infra/cdk/lib/triggers/custom-message.ts`): the code, how long it lasts,
 * "if you did not request this, ignore it". No promises and no marketing.
 */
import { composeMail, interpolate, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

/** Both values are text: the code as typed, the minutes as the mail prints them. */
export interface OneTimeCodeData {
  code: string;
  /** Whole minutes the code still lives, at least one. */
  minutes: string;
}

export const messages: Messages<'subject' | 'body' | 'ignore'> = {
  en: {
    subject: 'Your NestSelf verification code',
    body: 'Your verification code is {{code}}. It expires in {{minutes}} minutes.',
    ignore: 'If you did not request this, ignore this email.',
  },
  'sr-Latn': {
    subject: 'Vaš NestSelf verifikacioni kod',
    body: 'Vaš verifikacioni kod je {{code}}. Kod ističe za {{minutes}} minuta.',
    ignore: 'Ako niste zatražili ovaj kod, zanemarite ovu poruku.',
  },
  'sr-Cyrl': {
    subject: 'Ваш NestSelf верификациони код',
    body: 'Ваш верификациони код је {{code}}. Код истиче за {{minutes}} минута.',
    ignore: 'Ако нисте затражили овај код, занемарите ову поруку.',
  },
  hu: {
    subject: 'Az Ön NestSelf ellenőrző kódja',
    body: 'Az Ön ellenőrző kódja: {{code}}. A kód {{minutes}} percig érvényes.',
    ignore: 'Ha nem Ön kérte ezt a kódot, hagyja figyelmen kívül ezt az e-mailt.',
  },
};

export function render(locale: MailLocale, data: OneTimeCodeData): RenderedMail {
  const copy = messages[locale];
  const values = { code: data.code, minutes: data.minutes };
  return composeMail(locale, copy.subject, [paragraph(interpolate(copy.body, values)), paragraph(copy.ignore)]);
}
