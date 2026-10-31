/**
 * `sso_bind_code`: the one-time code that confirms the mailbox of a pending
 * SSO binding when the identity provider asserted the address without
 * `email_verified` (auth phase 4, spec 5.3; `docs/auth/implementation.md`
 * section 22.14).
 */
import { composeMail, interpolate, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';
import { type OneTimeCodeData } from './step-up-code.js';

export const messages: Messages<'subject' | 'body' | 'ignore'> = {
  en: {
    subject: 'Confirm your email address on NestSelf',
    body: 'Your code to confirm your email address is {{code}}. It expires in {{minutes}} minutes.',
    ignore: 'If you did not request this, ignore this email.',
  },
  'sr-Latn': {
    subject: 'Potvrdite adresu e-pošte na platformi NestSelf',
    body: 'Vaš kod za potvrdu adrese e-pošte je {{code}}. Kod ističe za {{minutes}} minuta.',
    ignore: 'Ako niste zatražili ovaj kod, zanemarite ovu poruku.',
  },
  'sr-Cyrl': {
    subject: 'Потврдите адресу е-поште на платформи NestSelf',
    body: 'Ваш код за потврду адресе е-поште је {{code}}. Код истиче за {{minutes}} минута.',
    ignore: 'Ако нисте затражили овај код, занемарите ову поруку.',
  },
  hu: {
    subject: 'E-mail-cím megerősítése a NestSelf platformon',
    body: 'Az Ön e-mail-cím megerősítő kódja: {{code}}. A kód {{minutes}} percig érvényes.',
    ignore: 'Ha nem Ön kérte ezt a kódot, hagyja figyelmen kívül ezt az e-mailt.',
  },
};

export function render(locale: MailLocale, data: OneTimeCodeData): RenderedMail {
  const copy = messages[locale];
  const values = { code: data.code, minutes: data.minutes };
  return composeMail(locale, copy.subject, [paragraph(interpolate(copy.body, values)), paragraph(copy.ignore)]);
}
