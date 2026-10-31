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

/** What a provider calls its failures: `MessageRejected`, `Throttling`, `TimeoutError`. */
const PROVIDER_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/**
 * The provider did not accept the mail. It carries what an operator needs to
 * tell failures apart, the provider's error `name` and the HTTP status, and
 * nothing else: the provider's own message can quote the recipient's address
 * (SES `MessageRejected` does), so it is dropped and the message is fixed.
 * Callers can therefore log `String(error)` without leaking an address.
 *
 * The details come straight from an untrusted error object, so the class keeps
 * only a `name` that is a plain identifier (else `MailDeliveryError`) and a
 * numeric `httpStatus`. The original error is not kept as `cause`.
 */
export class MailDeliveryError extends Error {
  /** The provider's HTTP status, when it gave one. */
  readonly httpStatus: number | undefined;

  constructor(details: { name?: unknown; httpStatus?: unknown } = {}) {
    super('The mail could not be delivered');
    const { name, httpStatus } = details;
    this.name = typeof name === 'string' && PROVIDER_ERROR_NAME.test(name) ? name : 'MailDeliveryError';
    this.httpStatus = typeof httpStatus === 'number' ? httpStatus : undefined;
  }
}

export abstract class Mailer {
  /**
   * Renders and sends one email. Rejects with a {@link MailDeliveryError} when
   * the provider refused it and with the render error when the message itself
   * is wrong (a template value is missing). Callers decide whether to log or
   * fail. A mail is sent after the transaction that justifies it has
   * committed, never inside it.
   */
  abstract send(input: MailInput): Promise<void>;
}

/** The code a `step_up_code` or `sso_bind_code` mail carries: what tests and the stub flows read back. */
export function oneTimeCode(mail: MailInput): string {
  if (mail.template !== 'step_up_code' && mail.template !== 'sso_bind_code') {
    throw new Error(`A ${mail.template} mail carries no code`);
  }
  return mail.data.code;
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
