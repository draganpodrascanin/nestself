/**
 * Default {@link Mailer} when SES is not configured (development, tests).
 *
 * Renders the email, so a broken template fails here too, then logs the
 * template, the locale, the recipient's domain and the subject at info
 * level. Never logs the address, the body or the join link: subjects are
 * neutral by design (CW-R-43), the body is not.
 */
import { Logger } from '@nestjs/common';
import { Mailer, recipientDomain, renderMail, type MailInput } from './mailer.js';

export class LoggingMailer extends Mailer {
  private readonly logger = new Logger(LoggingMailer.name);

  async send(input: MailInput): Promise<void> {
    const mail = renderMail(input);
    this.logger.log(
      `Email ${input.template} (${input.locale}) not sent, SES is not configured: recipient at ${recipientDomain(input.to)}, subject "${mail.subject}"`,
    );
  }
}
