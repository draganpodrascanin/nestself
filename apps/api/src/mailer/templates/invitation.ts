/**
 * `invitation`: the organisation invitation with the activation link
 * (D-03, D-29), moved from `SesInvitationMailer` onto the generalised mailer
 * (T-CW-1.3 step 6). The link is valid for 7 days (`EXPIRY_MS` in
 * `InvitationsService`).
 */
import {
  composeMail,
  interpolate,
  link,
  paragraph,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export interface InvitationData {
  organizationName: string;
  inviterDisplayName: string;
  /** Workspace activation link carrying the invitation token. */
  activationUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'activateAction' | 'validity'> = {
  en: {
    subject: 'You are invited to {{organizationName}} on NestSelf',
    body: '{{inviterName}} invited you to join {{organizationName}} on NestSelf.',
    activateAction: 'Activate your access',
    validity: 'The link is valid for 7 days. If you did not expect this invitation, you can ignore this email.',
  },
  'sr-Latn': {
    subject: 'Pozvani ste u organizaciju {{organizationName}} na platformi NestSelf',
    body: '{{inviterName}} vas poziva da se pridružite organizaciji {{organizationName}} na platformi NestSelf.',
    activateAction: 'Aktivirajte pristup',
    validity: 'Link važi 7 dana. Ako niste očekivali ovaj poziv, možete zanemariti ovu poruku.',
  },
  'sr-Cyrl': {
    subject: 'Позвани сте у организацију {{organizationName}} на платформи NestSelf',
    body: '{{inviterName}} вас позива да се придружите организацији {{organizationName}} на платформи NestSelf.',
    activateAction: 'Активирајте приступ',
    validity: 'Линк важи 7 дана. Ако нисте очекивали овај позив, можете занемарити ову поруку.',
  },
  hu: {
    subject: 'Meghívást kapott a(z) {{organizationName}} szervezetbe a NestSelf platformon',
    body: '{{inviterName}} meghívta, hogy csatlakozzon a(z) {{organizationName}} szervezethez a NestSelf platformon.',
    activateAction: 'Hozzáférés aktiválása',
    validity: 'A link 7 napig érvényes. Ha nem számított erre a meghívásra, nyugodtan figyelmen kívül hagyhatja ezt az e-mailt.',
  },
};

export function render(locale: MailLocale, data: InvitationData): RenderedMail {
  const copy = messages[locale];
  const values = { organizationName: data.organizationName, inviterName: data.inviterDisplayName };
  return composeMail(locale, interpolate(copy.subject, values), [
    paragraph(interpolate(copy.body, values)),
    link(copy.activateAction, data.activationUrl),
    paragraph(copy.validity),
  ]);
}
