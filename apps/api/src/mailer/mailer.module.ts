/**
 * Mailer module (T-CW-1.3): provides {@link Mailer}.
 *
 * - SES (`SesMailer`) when `SES_FROM_EMAIL` is set and `NODE_ENV` is not
 *   `test`, the rule the invitation mailer used (D-29). The region follows
 *   `COGNITO_REGION`, as before, and defaults to eu-central-1.
 * - Otherwise `LoggingMailer`, which keeps what it was asked to send (`sent`)
 *   only under `NODE_ENV=test` and in stub auth mode, for assertions.
 *
 * Global, like the audit and Redis modules: `AppModule` imports it once, the
 * auth, jobs and invitation modules inject `Mailer` without importing it, and
 * the worker process boots the same `AppModule`, so the nightly jobs get the
 * same mailer. Modules that list it in `imports` anyway (appointments,
 * webinars, calls jobs) are fine: the module is a singleton either way.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { keepsSentMail, LoggingMailer } from './logging-mailer.js';
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
  if (ses) return new SesMailer(ses);
  return new LoggingMailer({
    keepSent: keepsSentMail({ NODE_ENV: config.get<string>('NODE_ENV'), AUTH_MODE: config.get<string>('AUTH_MODE') }),
  });
}

@Global()
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
