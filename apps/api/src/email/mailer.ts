/**
 * The mail port. Callers say which template to send, in which locale and with
 * which params; the adapters (`SesMailer`, `LoggingMailer`) render and deliver.
 *
 * Rule: a mail is sent after the transaction that justifies it has committed,
 * never inside it. A rolled-back transaction must not leave a mail behind.
 */
import type { Locale } from '@nestself/contracts';

export type MailTemplate =
  'invitation' | 'step_up_code' | 'sso_bind_code' | 'ops_certificate_alert';

export interface MailMessage {
  to: string;
  locale: Locale;
  template: MailTemplate;
  /** Values for the template's `{{name}}` placeholders (see `EMAIL_TEMPLATES`). */
  params: Record<string, string>;
}

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
    this.name =
      typeof name === 'string' && PROVIDER_ERROR_NAME.test(name) ? name : 'MailDeliveryError';
    this.httpStatus = typeof httpStatus === 'number' ? httpStatus : undefined;
  }
}

/** Abstract class so it doubles as the NestJS injection token. */
export abstract class Mailer {
  /**
   * Rejects when the mail could not be handed over: with a {@link MailDeliveryError}
   * when the provider refused it, with the render error when the message itself
   * is wrong (a template param is missing). Callers decide whether to log or fail.
   */
  abstract send(message: MailMessage): Promise<void>;
}
