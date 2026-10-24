/**
 * Generalised mailer (T-CW-1.3, D-CW-26). `Mailer` is the abstract DI token;
 * `SesMailer` sends through SES and `LoggingMailer` logs a redacted line when
 * SES is not configured (`MailerModule`).
 *
 * `send(input)` takes the recipient, the locale, the template name and that
 * template's data; the registry in `templates/index.ts` makes the pair
 * type-safe. Templates render subject, text, HTML and, for the calendar
 * emails, the ICS part in all four locales.
 *
 * Deviation from guidelines 10.1 (subject and body keys resolved against the
 * i18n package): `apps/api` does not depend on `@nestself/i18n`, so the
 * templates are TypeScript modules that copy the `calls.json` wording.
 */
import { type MailInput } from './templates/index.js';

export abstract class Mailer {
  /** Renders and sends one email. Rejects when rendering or delivery fails. */
  abstract send(input: MailInput): Promise<void>;
}

export {
  MAIL_TEMPLATE_NAMES,
  renderMail,
  type MailAttachment,
  type MailEnvelope,
  type MailInput,
  type MailTemplateData,
  type MailTemplateName,
  type RenderedMail,
} from './templates/index.js';

/** Domain part of an address, the only part of a recipient the mailers log. */
export function recipientDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : '(no domain)';
}
