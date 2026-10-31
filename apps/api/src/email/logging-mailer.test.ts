import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepsSentMail, LoggingMailer } from './logging-mailer.js';
import { Mailer, type MailMessage } from './mailer.js';

const CODE_MAIL: MailMessage = {
  to: 'dragan@intesa.example',
  locale: 'sr-Latn',
  template: 'step_up_code',
  params: { code: '12345678', minutes: '5' },
};

describe('keepsSentMail', () => {
  it.each([
    { NODE_ENV: 'test', AUTH_MODE: 'cognito' },
    { NODE_ENV: 'development', AUTH_MODE: 'stub' },
    { NODE_ENV: 'development', AUTH_MODE: undefined },
    { NODE_ENV: undefined, AUTH_MODE: undefined },
  ])('keeps with %o', (env) => {
    expect(keepsSentMail(env)).toBe(true);
  });

  it.each([
    { NODE_ENV: 'development', AUTH_MODE: 'cognito' },
    { NODE_ENV: 'production', AUTH_MODE: 'cognito' },
  ])('keeps nothing with %o', (env) => {
    expect(keepsSentMail(env)).toBe(false);
  });

  it('reads the process environment when it is given none', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_MODE', 'cognito');
    expect(keepsSentMail()).toBe(false);

    vi.stubEnv('NODE_ENV', 'test');
    expect(keepsSentMail()).toBe(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe('LoggingMailer', () => {
  let debug: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('is a Mailer', () => {
    expect(new LoggingMailer()).toBeInstanceOf(Mailer);
  });

  it('keeps the messages it was asked to send when keepSent is on', async () => {
    const mailer = new LoggingMailer({ keepSent: true });

    await mailer.send(CODE_MAIL);
    await mailer.send({ ...CODE_MAIL, to: 'other@intesa.example' });

    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0]).toEqual(CODE_MAIL);
    expect(mailer.sent[1]?.to).toBe('other@intesa.example');
  });

  it('keeps nothing when keepSent is off, even under test', async () => {
    const mailer = new LoggingMailer({ keepSent: false });

    await mailer.send(CODE_MAIL);

    expect(mailer.sent).toEqual([]);
  });

  it('keeps the messages by default under NODE_ENV=test', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const mailer = new LoggingMailer();

    await mailer.send(CODE_MAIL);

    expect(mailer.sent).toEqual([CODE_MAIL]);
  });

  it('keeps nothing by default outside test and stub mode, because a code in memory is a secret in memory', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_MODE', 'cognito');
    const mailer = new LoggingMailer();

    await mailer.send(CODE_MAIL);

    expect(mailer.sent).toEqual([]);
  });

  it('logs the template, the locale and the recipient domain at debug level', async () => {
    await new LoggingMailer().send(CODE_MAIL);

    expect(debug).toHaveBeenCalledOnce();
    const line = String(debug.mock.calls[0]![0]);
    expect(line).toContain('step_up_code');
    expect(line).toContain('sr-Latn');
    expect(line).toContain('intesa.example');
  });

  it('never logs the address, the code or any other param', async () => {
    const mailer = new LoggingMailer({ keepSent: true });

    await mailer.send({
      to: 'dragan@intesa.example',
      locale: 'en',
      template: 'invitation',
      params: {
        link: 'https://app.example.test/invitations/tok_secret',
        organizationName: 'Intesa d.o.o.',
        inviterDisplayName: 'Ivana',
      },
    });
    await mailer.send(CODE_MAIL);

    for (const [argument] of debug.mock.calls) {
      const line = String(argument);
      for (const secret of ['dragan', 'tok_secret', 'Intesa d.o.o.', 'Ivana', '12345678']) {
        expect(line).not.toContain(secret);
      }
    }
  });
});
