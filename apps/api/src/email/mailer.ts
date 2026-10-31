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

/** Abstract class so it doubles as the NestJS injection token. */
export abstract class Mailer {
  /** Rejects when the mail could not be handed over; callers decide whether to log or fail. */
  abstract send(message: MailMessage): Promise<void>;
}
