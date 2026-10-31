/**
 * Default {@link Mailer} when SES is not configured (development, tests).
 *
 * Renders the email, so a broken template fails here too, then logs the
 * template, the locale, the recipient's domain and the subject at info
 * level. Never logs the address, the body, a code or the join link: subjects
 * are neutral by design (CW-R-43), the body is not.
 *
 * It also keeps every message in `sent`, so unit tests, the API e2e suites and
 * the Playwright journeys (stub mode) can read the code or link that "arrived",
 * but only under `NODE_ENV=test` and in stub auth mode ({@link keepsSentMail}):
 * a code held in memory is a secret in memory.
 */
import { Logger } from '@nestjs/common';
import { Mailer, recipientDomain, renderMail, type MailInput } from './mailer.js';

/** Placeholder From address for rendering (the calendar ORGANIZER); nothing is sent. */
export const LOGGING_MAILER_SENDER = 'no-reply@nestself.example';

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
  readonly sent: MailInput[] = [];

  constructor(options: LoggingMailerOptions = {}) {
    super();
    this.keepSent = options.keepSent ?? keepsSentMail();
  }

  async send(input: MailInput): Promise<void> {
    // Render as the SES adapter would, so a template whose value is missing
    // fails here, in development and in tests, not only in production.
    const mail = renderMail(input, LOGGING_MAILER_SENDER);
    if (this.keepSent) this.sent.push(input);
    this.logger.log(
      `Email ${input.template} (${input.locale}) not sent, SES is not configured: recipient at ${recipientDomain(input.to)}, subject "${mail.subject}"`,
    );
  }
}
