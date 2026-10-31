import { Logger } from '@nestjs/common';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailMessage } from './mailer.js';
import { renderMail } from './render-mail.js';
import { SesMailer } from './ses-mailer.js';

const OPTIONS = { fromEmail: 'no-reply@example.test', region: 'eu-central-1' };

const INVITATION: MailMessage = {
  to: 'invitee@example.test',
  locale: 'sr-Latn',
  template: 'invitation',
  params: {
    link: 'https://app.example.test/invitations/tok_123',
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
    expect(input.Message.Body.Text.Data).toContain('https://app.example.test/invitations/tok_123');
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

  it('propagates SES failures so the caller can log them', async () => {
    const send = vi.fn().mockRejectedValue(new Error('MessageRejected'));
    const mailer = new SesMailer({ ...OPTIONS, client: { send } });

    await expect(mailer.send(INVITATION)).rejects.toThrow('MessageRejected');
  });

  it('logs the template and the recipient domain, never the address, the code or the link', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mailer = new SesMailer({ ...OPTIONS, client: { send } });

    await mailer.send({
      to: 'dragan@intesa.example',
      locale: 'en',
      template: 'step_up_code',
      params: { code: '12345678', minutes: '5' },
    });

    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain('step_up_code');
    expect(line).toContain('intesa.example');
    expect(line).not.toContain('dragan');
    expect(line).not.toContain('12345678');
  });
});
