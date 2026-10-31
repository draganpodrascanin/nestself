/**
 * The SES mailer [D-29]. Selected by `EmailModule` when `SES_FROM_EMAIL` is
 * set and `NODE_ENV` is not `test`.
 *
 * Renders the message and sends it as one plain-text and HTML mail. Failures
 * propagate: the caller decides whether a mail that did not go out is worth a
 * log line (an invitation) or a failed request. A refusal by SES reaches the
 * caller as a {@link MailDeliveryError}: the SDK's own message can quote the
 * recipient's address, so only its name and HTTP status are passed on.
 *
 * The log line names the template, the locale and the recipient's domain; the
 * params (codes, activation links) and the address never reach the log.
 */
import { Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { emailDomain } from './mask-email.js';
import { MailDeliveryError, Mailer, type MailMessage } from './mailer.js';
import { renderMail } from './render-mail.js';

export interface SesMailerOptions {
  fromEmail: string;
  region: string;
  /** Injected in tests; defaults to a real SES client. */
  client?: Pick<SESClient, 'send'>;
}

/** The two parts of an AWS SDK error that are safe to keep: its name and its HTTP status. */
function deliveryErrorFrom(failure: unknown): MailDeliveryError {
  const { name, $metadata } = (typeof failure === 'object' && failure !== null ? failure : {}) as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown } | null;
  };
  return new MailDeliveryError({ name, httpStatus: $metadata?.httpStatusCode });
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

    try {
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
    } catch (failure) {
      throw deliveryErrorFrom(failure);
    }
    this.logger.log(
      `Mail sent: template=${message.template} locale=${message.locale} recipientDomain=${emailDomain(message.to)}`,
    );
  }
}
