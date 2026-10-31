import { Logger } from '@nestjs/common';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailDeliveryError, type MailMessage } from './mailer.js';
import { renderMail } from './render-mail.js';
import { SesMailer } from './ses-mailer.js';

const OPTIONS = { fromEmail: 'no-reply@example.test', region: 'eu-central-1' };

const INVITATION: MailMessage = {
  to: 'invitee@example.test',
  locale: 'sr-Latn',
  template: 'invitation',
  params: {
    link: 'https://app.example.test/invite/tok_123',
    organizationName: 'Example <d.o.o.>',
    inviterDisplayName: 'Ivana',
  },
};

interface SentInput {
  Source: string;
  Destination: { ToAddresses: string[] };
  Message: {
    Subject: { Data: string; Charset: string };
    Body: { Text: { Data: string; Charset: string }; Html: { Data: string; Charset: string } };
  };
}

function inputOf(send: ReturnType<typeof vi.fn>): SentInput {
  const command = send.mock.calls[0]![0] as SendEmailCommand;
  expect(command).toBeInstanceOf(SendEmailCommand);
  return command.input as unknown as SentInput;
}

describe('SesMailer', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the rendered subject, text and HTML from the configured sender to the recipient', async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: 'm-1' });
    const mailer = new SesMailer({ ...OPTIONS, client: { send } });

    await mailer.send(INVITATION);

    expect(send).toHaveBeenCalledOnce();
    const rendered = renderMail(INVITATION);
    expect(inputOf(send)).toEqual({
      Source: 'no-reply@example.test',
      Destination: { ToAddresses: ['invitee@example.test'] },
      Message: {
        Subject: { Data: rendered.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: rendered.text, Charset: 'UTF-8' },
          Html: { Data: rendered.html, Charset: 'UTF-8' },
        },
      },
    });
  });

  it('carries the activation link in the text, and the escaped organization name in the HTML', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mailer = new SesMailer({ ...OPTIONS, client: { send } });

    await mailer.send({ ...INVITATION, locale: 'en' });

    const input = inputOf(send);
    expect(input.Message.Body.Text.Data).toContain('https://app.example.test/invite/tok_123');
    expect(input.Message.Body.Html.Data).toContain('Example &lt;d.o.o.&gt;');
    expect(input.Message.Subject.Data).toContain('Example <d.o.o.>');
  });

  it('sends Cyrillic copy as UTF-8', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mailer = new SesMailer({ ...OPTIONS, client: { send } });

    await mailer.send({
      to: 'a@b.test',
      locale: 'sr-Cyrl',
      template: 'step_up_code',
      params: { code: '12345678', minutes: '5' },
    });

    const input = inputOf(send);
    expect(input.Message.Subject).toEqual({
      Data: 'Ваш NestSelf верификациони код',
      Charset: 'UTF-8',
    });
    expect(input.Message.Body.Text.Charset).toBe('UTF-8');
    expect(input.Message.Body.Html.Charset).toBe('UTF-8');
  });

  describe('when SES refuses the mail', () => {
    /** What the SDK throws: the message quotes the recipient's address. */
    function sesFailure(httpStatusCode?: number): Error {
      return Object.assign(
        new Error(
          'Email address is not verified. The following identities failed the check in region EU-CENTRAL-1: invitee@example.test',
        ),
        {
          name: 'MessageRejected',
          ...(httpStatusCode === undefined ? {} : { $metadata: { httpStatusCode } }),
        },
      );
    }

    async function failureOf(failure: unknown): Promise<MailDeliveryError> {
      const send = vi.fn().mockRejectedValue(failure);
      const mailer = new SesMailer({ ...OPTIONS, client: { send } });
      const error: unknown = await mailer.send(INVITATION).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(MailDeliveryError);
      return error as MailDeliveryError;
    }

    it('rethrows a MailDeliveryError that carries the SDK error name and the HTTP status', async () => {
      const error = await failureOf(sesFailure(400));

      expect(error.name).toBe('MessageRejected');
      expect(error.httpStatus).toBe(400);
      expect(String(error)).toBe('MessageRejected: The mail could not be delivered');
    });

    it('never carries the SDK message, so logging String(error) cannot leak the recipient', async () => {
      const error = await failureOf(sesFailure(400));

      const everything = [
        String(error),
        error.message,
        error.stack ?? '',
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
      ].join('\n');
      expect(everything).not.toContain('invitee@example.test');
      expect(everything).not.toContain('not verified');
      expect(error.cause).toBeUndefined();
    });

    it('leaves the HTTP status out when the SDK gave none', async () => {
      const error = await failureOf(sesFailure());

      expect(error.httpStatus).toBeUndefined();
    });

    it.each([
      ['a string', 'invitee@example.test could not be reached'],
      [
        'an error whose name is free text',
        Object.assign(new Error('x'), { name: 'failed for invitee@example.test' }),
      ],
      ['nothing', undefined],
    ])('keeps a failure that is %s from reaching the error', async (_label, failure) => {
      const error = await failureOf(failure);

      expect(error.name).toBe('MailDeliveryError');
      expect(String(error)).not.toContain('invitee@example.test');
    });

    it('does not log the failure itself: the caller decides', async () => {
      await failureOf(sesFailure(400));

      expect(log).not.toHaveBeenCalled();
    });
  });

  it('does not wrap an error from rendering: a missing param is a bug, not a delivery failure', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mailer = new SesMailer({ ...OPTIONS, client: { send } });

    await expect(
      mailer.send({
        ...INVITATION,
        params: { link: 'https://app.example.test/invite/tok_123' },
      }),
    ).rejects.toThrow(/invitation.*organizationName/);
    expect(send).not.toHaveBeenCalled();
  });

  it('logs the template and the recipient domain, never the address, the code or the link', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mailer = new SesMailer({ ...OPTIONS, client: { send } });

    await mailer.send({
      to: 'ivana@acme.example',
      locale: 'en',
      template: 'step_up_code',
      params: { code: '12345678', minutes: '5' },
    });

    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain('step_up_code');
    expect(line).toContain('acme.example');
    expect(line).not.toContain('ivana');
    expect(line).not.toContain('12345678');
  });
});
