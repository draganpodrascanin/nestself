/**
 * Mailer module (T-CW-1.3): provides {@link Mailer}.
 *
 * - SES (`SesMailer`) when `SES_FROM_EMAIL` is set and `NODE_ENV` is not
 *   `test`, the rule the invitation mailer used (D-29). The region follows
 *   `COGNITO_REGION`, as before, and defaults to eu-central-1.
 * - Otherwise `LoggingMailer`.
 *
 * Imported by the modules that send email (today `InvitationsModule`); it is
 * not global.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggingMailer } from './logging-mailer.js';
import { Mailer } from './mailer.js';
import { SesMailer } from './ses-mailer.js';

interface ConfigReader {
  get<T = string>(key: string): T | undefined;
}

/** SES settings when SES should be used, otherwise null. */
export function sesMailerOptions(config: ConfigReader): { fromEmail: string; region: string } | null {
  const fromEmail = config.get<string>('SES_FROM_EMAIL');
  if (!fromEmail || config.get<string>('NODE_ENV') === 'test') return null;
  return { fromEmail, region: config.get<string>('COGNITO_REGION') ?? 'eu-central-1' };
}

export function createMailer(config: ConfigReader): Mailer {
  const ses = sesMailerOptions(config);
  return ses ? new SesMailer(ses) : new LoggingMailer();
}

@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Mailer => createMailer(config),
    },
  ],
  exports: [Mailer],
})
export class MailerModule {}
