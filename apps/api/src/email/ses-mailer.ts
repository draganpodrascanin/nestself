/**
 * The SES mailer [D-29]. Selected by `EmailModule` when `SES_FROM_EMAIL` is
 * set and `NODE_ENV` is not `test`.
 *
 * Renders the message and sends it as one plain-text and HTML mail. Failures
 * propagate: the caller decides whether a mail that did not go out is worth a
 * log line (an invitation) or a failed request.
 *
 * The log line names the template, the locale and the recipient's domain; the
 * params (codes, activation links) and the address never reach the log.
 */
import { Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { emailDomain } from './mask-email.js';
import { Mailer, type MailMessage } from './mailer.js';
import { renderMail } from './render-mail.js';

export interface SesMailerOptions {
  fromEmail: string;
  region: string;
  /** Injected in tests; defaults to a real SES client. */
  client?: Pick<SESClient, 'send'>;
}

export class SesMailer extends Mailer {
  private readonly logger = new Logger(SesMailer.name);
  private readonly client: Pick<SESClient, 'send'>;

  constructor(private readonly options: SesMailerOptions) {
    super();
    this.client = options.client ?? new SESClient({ region: options.region });
  }

  async send(message: MailMessage): Promise<void> {
    const { subject, text, html } = renderMail(message);

    await this.client.send(
      new SendEmailCommand({
        Source: this.options.fromEmail,
        Destination: { ToAddresses: [message.to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            Html: { Data: html, Charset: 'UTF-8' },
          },
        },
      }),
    );
    this.logger.log(
      `Mail sent: template=${message.template} locale=${message.locale} recipientDomain=${emailDomain(message.to)}`,
    );
  }
}
