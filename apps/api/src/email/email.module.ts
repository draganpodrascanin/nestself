/**
 * EmailModule: provides the {@link Mailer} port to the whole application.
 *
 * - `SesMailer` when `SES_FROM_EMAIL` is set and `NODE_ENV` is not `test`;
 *   the region is `COGNITO_REGION`, else `eu-central-1` (data residency).
 * - `LoggingMailer` otherwise. It keeps what it was asked to send (`sent`)
 *   only under `NODE_ENV=test` and in stub auth mode, for assertions.
 *
 * Global, like the audit and Redis modules: the worker process boots the same
 * `AppModule`, so the nightly jobs get the same mailer.
 *
 * @see D-29
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { keepsSentMail, LoggingMailer } from './logging-mailer.js';
import { Mailer } from './mailer.js';
import { SesMailer } from './ses-mailer.js';

/** What {@link createMailer} reads; `ConfigService` satisfies it. */
export interface MailerConfig {
  get(key: string): string | undefined;
}

export function createMailer(config: MailerConfig): Mailer {
  const nodeEnv = config.get('NODE_ENV');
  const fromEmail = config.get('SES_FROM_EMAIL');
  if (fromEmail && nodeEnv !== 'test') {
    return new SesMailer({ fromEmail, region: config.get('COGNITO_REGION') ?? 'eu-central-1' });
  }
  return new LoggingMailer({
    keepSent: keepsSentMail({ NODE_ENV: nodeEnv, AUTH_MODE: config.get('AUTH_MODE') }),
  });
}

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: createMailer,
    },
  ],
  exports: [Mailer],
})
export class EmailModule {}
