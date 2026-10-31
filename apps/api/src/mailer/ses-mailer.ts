/**
 * SES implementation of {@link Mailer} [D-29, D-CW-26].
 *
 * Sends a raw MIME message (`SendRawEmailCommand`), because the calendar
 * emails carry a `text/calendar` part that `SendEmailCommand` cannot attach.
 * Logs the template, the locale and the recipient's domain only: never the
 * address, the body or the join link. A refusal by SES reaches the caller as a
 * {@link MailDeliveryError}: the SDK's own message can quote the recipient's
 * address, so only its name and HTTP status are passed on.
 */
import { SendRawEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import { MailDeliveryError, Mailer, recipientDomain, renderMail, type MailInput } from './mailer.js';
import { buildRawMessage, isSingleAddress } from './mime.js';

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

  async send(input: MailInput): Promise<void> {
    if (!isSingleAddress(input.to)) throw new Error('Invalid recipient address');
    const mail = renderMail(input, this.options.fromEmail);
    const raw = buildRawMessage({ from: this.options.fromEmail, to: input.to, ...mail });
    try {
      await this.client.send(
        new SendRawEmailCommand({
          Source: this.options.fromEmail,
          Destinations: [input.to],
          RawMessage: { Data: Buffer.from(raw, 'utf8') },
        }),
      );
    } catch (failure) {
      throw deliveryErrorFrom(failure);
    }
    this.logger.log(`Email ${input.template} (${input.locale}) sent to a recipient at ${recipientDomain(input.to)}`);
  }
}
