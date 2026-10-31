import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMailer, EmailModule, type MailerConfig } from './email.module.js';
import { LoggingMailer } from './logging-mailer.js';
import { Mailer, type MailMessage } from './mailer.js';
import { SesMailer } from './ses-mailer.js';

const MAIL: MailMessage = {
  to: 'ivana@acme.example',
  locale: 'en',
  template: 'step_up_code',
  params: { code: '12345678', minutes: '5' },
};

function configOf(values: Record<string, string | undefined>): MailerConfig {
  return { get: (key) => values[key] };
}

describe('createMailer', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses SES when a sender is configured outside test', () => {
    const mailer = createMailer(
      configOf({
        SES_FROM_EMAIL: 'no-reply@nestself.example',
        NODE_ENV: 'production',
        AUTH_MODE: 'cognito',
      }),
    );

    expect(mailer).toBeInstanceOf(SesMailer);
  });

  it('sends from the configured sender in the Cognito region', () => {
    const mailer = createMailer(
      configOf({
        SES_FROM_EMAIL: 'no-reply@nestself.example',
        NODE_ENV: 'production',
        COGNITO_REGION: 'eu-west-1',
      }),
    );

    expect((mailer as SesMailer)['options']).toMatchObject({
      fromEmail: 'no-reply@nestself.example',
      region: 'eu-west-1',
    });
  });

  it('defaults the SES region to eu-central-1', () => {
    const mailer = createMailer(
      configOf({ SES_FROM_EMAIL: 'no-reply@nestself.example', NODE_ENV: 'production' }),
    );

    expect((mailer as SesMailer)['options']).toMatchObject({ region: 'eu-central-1' });
  });

  it('logs instead of sending when no sender is configured', () => {
    expect(createMailer(configOf({ NODE_ENV: 'production', AUTH_MODE: 'cognito' }))).toBeInstanceOf(
      LoggingMailer,
    );
  });

  it('logs under NODE_ENV=test even when a sender is configured', () => {
    const mailer = createMailer(
      configOf({ SES_FROM_EMAIL: 'no-reply@nestself.example', NODE_ENV: 'test' }),
    );

    expect(mailer).toBeInstanceOf(LoggingMailer);
  });

  it.each([
    { NODE_ENV: 'test', AUTH_MODE: 'cognito' },
    { NODE_ENV: 'development', AUTH_MODE: 'stub' },
    { NODE_ENV: 'development', AUTH_MODE: undefined },
  ])('keeps the sent messages for assertions with %o', async (env) => {
    const mailer = createMailer(configOf(env)) as LoggingMailer;

    await mailer.send(MAIL);

    expect(mailer.sent).toEqual([MAIL]);
  });

  it.each([
    { NODE_ENV: 'development', AUTH_MODE: 'cognito' },
    { NODE_ENV: 'production', AUTH_MODE: 'cognito' },
  ])('keeps nothing with %o', async (env) => {
    const mailer = createMailer(configOf(env)) as LoggingMailer;

    await mailer.send(MAIL);

    expect(mailer.sent).toEqual([]);
  });
});

describe('EmailModule', () => {
  @Injectable()
  class MailerConsumer {
    constructor(@Inject(Mailer) readonly mailer: Mailer) {}
  }

  // Does not import EmailModule: the module is global.
  @Module({ providers: [MailerConsumer] })
  class ConsumerModule {}

  it('provides the Mailer to modules that do not import it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EmailModule,
        ConsumerModule,
      ],
    }).compile();

    // NODE_ENV=test in the unit test environment: the logging adapter.
    expect(moduleRef.get(MailerConsumer).mailer).toBeInstanceOf(LoggingMailer);
    expect(moduleRef.get(Mailer)).toBe(moduleRef.get(MailerConsumer).mailer);

    await moduleRef.close();
  });
});
