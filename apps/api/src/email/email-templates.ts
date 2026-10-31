/**
 * The copy of every mail, in the four locales.
 *
 * Placeholders are `{{name}}` and are filled from `MailMessage.params` by
 * `renderMail`. Each template takes exactly these params:
 *
 * - `invitation`: `link`, `organizationName`, `inviterDisplayName`
 * - `step_up_code`, `sso_bind_code`: `code`, `minutes`
 * - `ops_certificate_alert`: `organizationName`, `providerName`, `expiresAt`,
 *   `daysLeft` (whole days; zero or negative once expired), `adminUrl`
 *
 * Tone follows the Cognito CustomMessage trigger (`infra/cdk/lib/triggers/custom-message.ts`):
 * the code, how long it lasts, "if you did not request this, ignore it". No
 * promises and no marketing. A paragraph is one line; `text` separates
 * paragraphs with a blank line and `renderMail` turns each into a `<p>`.
 *
 * `sr-Cyrl` is the Latin copy run through the catalogs' transliteration
 * (`packages/i18n/scripts/transliterate-core.mjs`). Do not edit it by hand:
 * change the `sr-Latn` text, regenerate the Cyrillic with that function and
 * let `email-templates.test.ts` confirm they agree. The Latin copy is a draft
 * pending a native speaker review, like the catalogs.
 */
import type { Locale } from '@nestself/contracts';
import type { MailTemplate } from './mailer.js';

export interface MailCopy {
  subject: string;
  text: string;
}

function paragraphs(...lines: string[]): string {
  return lines.join('\n\n');
}

/** The operations mailbox reads English only, so one text fills all four locale slots. */
const OPS_CERTIFICATE_ALERT: MailCopy = {
  subject: 'SSO certificate expiry notice: {{organizationName}}',
  text: paragraphs(
    'The signing certificate of the SSO connection {{providerName}} ({{organizationName}}) expires on {{expiresAt}}. Days left: {{daysLeft}}.',
    'Review the connection and ask the organization to renew the certificate: {{adminUrl}}',
  ),
};

export const EMAIL_TEMPLATES: Record<MailTemplate, Record<Locale, MailCopy>> = {
  invitation: {
    en: {
      subject: 'You are invited to {{organizationName}} on NestSelf',
      text: paragraphs(
        '{{inviterDisplayName}} invited you to join {{organizationName}} on NestSelf.',
        'Open this link to activate your access: {{link}}',
        'The link is valid for 7 days. If you did not expect this invitation, you can ignore this email.',
      ),
    },
    'sr-Latn': {
      subject: 'Pozvani ste u organizaciju {{organizationName}} na platformi NestSelf',
      text: paragraphs(
        '{{inviterDisplayName}} vas poziva da se pridružite organizaciji {{organizationName}} na platformi NestSelf.',
        'Otvorite ovaj link da biste aktivirali pristup: {{link}}',
        'Link važi 7 dana. Ako niste očekivali ovaj poziv, možete zanemariti ovu poruku.',
      ),
    },
    'sr-Cyrl': {
      subject: 'Позвани сте у организацију {{organizationName}} на платформи NestSelf',
      text: paragraphs(
        '{{inviterDisplayName}} вас позива да се придружите организацији {{organizationName}} на платформи NestSelf.',
        'Отворите овај линк да бисте активирали приступ: {{link}}',
        'Линк важи 7 дана. Ако нисте очекивали овај позив, можете занемарити ову поруку.',
      ),
    },
    hu: {
      subject: 'Meghívást kapott a(z) {{organizationName}} szervezetbe a NestSelf platformon',
      text: paragraphs(
        '{{inviterDisplayName}} meghívta Önt a(z) {{organizationName}} szervezetbe a NestSelf platformon.',
        'A hozzáférés aktiválásához nyissa meg ezt a linket: {{link}}',
        'A link 7 napig érvényes. Ha nem számított erre a meghívásra, figyelmen kívül hagyhatja ezt az e-mailt.',
      ),
    },
  },

  step_up_code: {
    en: {
      subject: 'Your NestSelf verification code',
      text: paragraphs(
        'Your verification code is {{code}}. It expires in {{minutes}} minutes.',
        'If you did not request this, ignore this email.',
      ),
    },
    'sr-Latn': {
      subject: 'Vaš NestSelf verifikacioni kod',
      text: paragraphs(
        'Vaš verifikacioni kod je {{code}}. Kod ističe za {{minutes}} minuta.',
        'Ako niste zatražili ovaj kod, zanemarite ovu poruku.',
      ),
    },
    'sr-Cyrl': {
      subject: 'Ваш NestSelf верификациони код',
      text: paragraphs(
        'Ваш верификациони код је {{code}}. Код истиче за {{minutes}} минута.',
        'Ако нисте затражили овај код, занемарите ову поруку.',
      ),
    },
    hu: {
      subject: 'Az Ön NestSelf ellenőrző kódja',
      text: paragraphs(
        'Az Ön ellenőrző kódja: {{code}}. A kód {{minutes}} percig érvényes.',
        'Ha nem Ön kérte ezt a kódot, hagyja figyelmen kívül ezt az e-mailt.',
      ),
    },
  },

  sso_bind_code: {
    en: {
      subject: 'Confirm your email address on NestSelf',
      text: paragraphs(
        'Your code to confirm your email address is {{code}}. It expires in {{minutes}} minutes.',
        'If you did not request this, ignore this email.',
      ),
    },
    'sr-Latn': {
      subject: 'Potvrdite adresu e-pošte na platformi NestSelf',
      text: paragraphs(
        'Vaš kod za potvrdu adrese e-pošte je {{code}}. Kod ističe za {{minutes}} minuta.',
        'Ako niste zatražili ovaj kod, zanemarite ovu poruku.',
      ),
    },
    'sr-Cyrl': {
      subject: 'Потврдите адресу е-поште на платформи NestSelf',
      text: paragraphs(
        'Ваш код за потврду адресе е-поште је {{code}}. Код истиче за {{minutes}} минута.',
        'Ако нисте затражили овај код, занемарите ову поруку.',
      ),
    },
    hu: {
      subject: 'E-mail-cím megerősítése a NestSelf platformon',
      text: paragraphs(
        'Az Ön e-mail-cím megerősítő kódja: {{code}}. A kód {{minutes}} percig érvényes.',
        'Ha nem Ön kérte ezt a kódot, hagyja figyelmen kívül ezt az e-mailt.',
      ),
    },
  },

  ops_certificate_alert: {
    en: OPS_CERTIFICATE_ALERT,
    'sr-Latn': OPS_CERTIFICATE_ALERT,
    'sr-Cyrl': OPS_CERTIFICATE_ALERT,
    hu: OPS_CERTIFICATE_ALERT,
  },
};
