/**
 * The mailer for environments without SES: local development, tests and any
 * stage that has no `SES_FROM_EMAIL`. It sends nothing.
 *
 * It logs the template, the locale and the recipient's domain at debug level,
 * and nothing else: not the address, and not the params, which hold the codes
 * and the activation links. It renders every message first (and discards the
 * result), so a message the SES adapter could not render fails here too.
 *
 * It also keeps every message in `sent`, so unit tests, the API e2e suites and
 * the Playwright journeys (stub mode) can read the code or link that "arrived",
 * but only under `NODE_ENV=test` and in stub auth mode ({@link keepsSentMail}):
 * a code held in memory is a secret in memory.
 */
import { Logger } from '@nestjs/common';
import { emailDomain } from './mask-email.js';
import { Mailer, type MailMessage } from './mailer.js';
import { renderMail } from './render-mail.js';

/** The two settings that decide whether sent mail is kept. */
export interface MailEnvironment {
  NODE_ENV?: string | undefined;
  AUTH_MODE?: string | undefined;
}

/**
 * Test runs and stub auth mode (local development, Playwright) keep what they
 * "sent"; anything else does not. `AUTH_MODE` defaults to `stub`, as in `config/env.ts`.
 */
export function keepsSentMail(env: MailEnvironment = process.env): boolean {
  return env.NODE_ENV === 'test' || (env.AUTH_MODE ?? 'stub') === 'stub';
}

export interface LoggingMailerOptions {
  /** Overrides {@link keepsSentMail} for the process environment. */
  keepSent?: boolean;
}

export class LoggingMailer extends Mailer {
  private readonly logger = new Logger(LoggingMailer.name);
  private readonly keepSent: boolean;

  /** The messages handed to `send`, oldest first; stays empty unless {@link keepsSentMail} allows it. */
  readonly sent: MailMessage[] = [];

  constructor(options: LoggingMailerOptions = {}) {
    super();
    this.keepSent = options.keepSent ?? keepsSentMail();
  }

  async send(message: MailMessage): Promise<void> {
    // Render as the SES adapter would, so a template whose param is missing or
    // misnamed fails here, in development and in tests, not only in production.
    renderMail(message);
    if (this.keepSent) this.sent.push(message);
    this.logger.debug(
      `Mail not delivered (logging mailer): template=${message.template} locale=${message.locale} recipientDomain=${emailDomain(message.to)}`,
    );
  }
}
