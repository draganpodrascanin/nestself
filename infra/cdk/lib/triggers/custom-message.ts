import type {
  CustomMessageTriggerEvent,
  CustomMessageTriggerHandler,
} from 'aws-lambda';

/**
 * Cognito CustomMessage Lambda trigger.
 *
 * Selects the email template locale from custom:locale, then
 * clientMetadata.locale, then falls back to sr-Latn (the platform default).
 *
 * Handled trigger sources:
 *   CustomMessage_Authentication       - email OTP code
 *   CustomMessage_AdminCreateUser      - invitation (returned unchanged; suppressed by API)
 *   CustomMessage_ForgotPassword       - password reset code
 *   CustomMessage_VerifyUserAttribute  - email verification code
 *   CustomMessage_UpdateUserAttribute  - email change verification code
 *   CustomMessage_ResendCode           - resend verification code
 */

interface Template {
  readonly subject: string;
  readonly body: string;
}

type LocaleTemplates = Record<string, Template>;

const SUPPORTED_LOCALES = ['sr-Latn', 'sr-Cyrl', 'hu', 'en'] as const;
const DEFAULT_LOCALE = 'sr-Latn';

const TEMPLATES: Record<string, LocaleTemplates> = {
  CustomMessage_Authentication: {
    'sr-Latn': {
      subject: 'Jednokratni kod za prijavljivanje',
      body: 'Kod za prijavljivanje: {####}. Kod istice za 10 minuta.',
    },
    'sr-Cyrl': {
      subject: 'Једнократни код за пријављивање',
      body: 'Код за пријављивање: {####}. Код истиче за 10 минута.',
    },
    hu: {
      subject: 'Egyszeri bejelentkezesi kod',
      body: 'Bejelentkezesi kod: {####}. A kod 10 percig ervenyes.',
    },
    en: {
      subject: 'Your sign-in code',
      body: 'Your sign-in code is {####}. It expires in 10 minutes.',
    },
  },
  CustomMessage_ForgotPassword: {
    'sr-Latn': {
      subject: 'Kod za resetovanje lozinke',
      body: 'Kod za resetovanje lozinke: {####}.',
    },
    'sr-Cyrl': {
      subject: 'Код за ресетовање лозинке',
      body: 'Код за ресетовање лозинке: {####}.',
    },
    hu: {
      subject: 'Jelszo-visszaallitasi kod',
      body: 'Jelszo-visszaallitasi kod: {####}.',
    },
    en: {
      subject: 'Password reset code',
      body: 'Your password reset code is {####}.',
    },
  },
  CustomMessage_VerifyUserAttribute: {
    'sr-Latn': {
      subject: 'Kod za potvrdu adrese e-poste',
      body: 'Kod za potvrdu: {####}.',
    },
    'sr-Cyrl': {
      subject: 'Код за потврду адресе е-поште',
      body: 'Код за потврду: {####}.',
    },
    hu: {
      subject: 'E-mail cim megerosito kod',
      body: 'Megerosito kod: {####}.',
    },
    en: {
      subject: 'Email verification code',
      body: 'Your verification code is {####}.',
    },
  },
  CustomMessage_UpdateUserAttribute: {
    'sr-Latn': {
      subject: 'Kod za potvrdu promene adrese e-poste',
      body: 'Kod za potvrdu promene: {####}.',
    },
    'sr-Cyrl': {
      subject: 'Код за потврду промене адресе е-поште',
      body: 'Код за потврду промене: {####}.',
    },
    hu: {
      subject: 'E-mail cim valtoztatas megerosito kod',
      body: 'Valtoztatas megerosito kod: {####}.',
    },
    en: {
      subject: 'Email change verification code',
      body: 'Your email change verification code is {####}.',
    },
  },
  CustomMessage_ResendCode: {
    'sr-Latn': {
      subject: 'Ponovni kod za potvrdu',
      body: 'Novi kod za potvrdu: {####}.',
    },
    'sr-Cyrl': {
      subject: 'Поновни код за потврду',
      body: 'Нови код за потврду: {####}.',
    },
    hu: {
      subject: 'Uj megerosito kod',
      body: 'Uj megerosito kod: {####}.',
    },
    en: {
      subject: 'New verification code',
      body: 'Your new verification code is {####}.',
    },
  },
};

function resolveLocale(event: CustomMessageTriggerEvent): string {
  const fromAttr = event.request.userAttributes['custom:locale'];
  const fromMeta = event.request.clientMetadata?.['locale'];
  const locale = fromAttr ?? fromMeta ?? DEFAULT_LOCALE;
  if ((SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

export const handler: CustomMessageTriggerHandler = async (event) => {
  const locale = resolveLocale(event);
  const { triggerSource } = event;

  // AdminCreateUser messages are suppressed (MessageAction: SUPPRESS) [D-03].
  // The API sends its own invitation email. Return unchanged.
  if (triggerSource === 'CustomMessage_AdminCreateUser') {
    return event;
  }

  const templates = TEMPLATES[triggerSource];
  if (templates) {
    const tpl = templates[locale] ?? templates[DEFAULT_LOCALE]!;
    event.response.emailSubject = tpl.subject;
    event.response.emailMessage = tpl.body;
  } else {
    console.warn(`CustomMessage: unhandled triggerSource=${triggerSource}, locale=${locale}`);
  }

  return event;
};
