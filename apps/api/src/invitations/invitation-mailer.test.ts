/**
 * The invitation mailer hands the `invitation` template to the generalised
 * mailer (T-CW-1.3 step 6) with the workspace activation link.
 */
import { SendRawEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SesMailer } from '../mailer/ses-mailer.js';
import { InvitationMailer } from './invitation-mailer.js';

const INPUT = {
  email: 'invitee@example.test',
  token: 'tok_123',
  organizationName: 'Example <d.o.o.>',
  inviterDisplayName: 'Ivana',
};

function setup(workspaceUrl?: string) {
  const mailer = { send: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn((key: string) => (key === 'WORKSPACE_URL' ? workspaceUrl : undefined)),
  };
  const invitationMailer = new InvitationMailer(mailer as never, config as never);
  return { mailer, invitationMailer };
}

describe('InvitationMailer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hands the invitation template, the platform default locale and the activation link to the Mailer', async () => {
    const { mailer, invitationMailer } = setup('https://app.example.test');

    await invitationMailer.send(INPUT);

    expect(mailer.send).toHaveBeenCalledExactlyOnceWith({
      to: 'invitee@example.test',
      locale: 'sr-Latn',
      template: 'invitation',
      data: {
        organizationName: 'Example <d.o.o.>',
        inviterDisplayName: 'Ivana',
        activationUrl: 'https://app.example.test/invite/tok_123',
      },
    });
  });

  it("uses the invitee's locale when the invitation carries one", async () => {
    const { mailer, invitationMailer } = setup('https://app.example.test');
    await invitationMailer.send({ ...INPUT, locale: 'hu' });
    expect(mailer.send.mock.calls[0]![0]).toMatchObject({ locale: 'hu' });
  });

  it('builds the link on the local workspace origin when WORKSPACE_URL is unset', async () => {
    const { mailer, invitationMailer } = setup();

    await invitationMailer.send(INPUT);

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activationUrl: 'http://localhost:5173/invite/tok_123' }),
      }),
    );
  });

  it('propagates a Mailer failure so the caller can log it', async () => {
    const { mailer, invitationMailer } = setup('https://app.example.test');
    mailer.send.mockRejectedValue(new Error('MessageRejected'));

    await expect(invitationMailer.send(INPUT)).rejects.toThrow('MessageRejected');
  });

  it('sends a plain-text and HTML email with the activation link through SES', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const ses = mockClient(SESClient);
    ses.on(SendRawEmailCommand).resolves({ MessageId: 'msg-1' });
    try {
      const mailer = new SesMailer({ fromEmail: 'no-reply@example.test', region: 'eu-central-1' });
      const config = { get: (key: string) => (key === 'WORKSPACE_URL' ? 'https://app.example.test' : undefined) };
      await new InvitationMailer(mailer, config as never).send({ ...INPUT, locale: 'en' });

      const calls = ses.commandCalls(SendRawEmailCommand);
      expect(calls).toHaveLength(1);
      const command = calls[0]!.args[0].input;
      expect(command.Source).toBe('no-reply@example.test');
      expect(command.Destinations).toEqual(['invitee@example.test']);
      const raw = Buffer.from(command.RawMessage!.Data!).toString('utf8');
      const decodedParts = [...raw.matchAll(/\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((match) =>
        Buffer.from(match[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'),
      );
      const [text, html] = decodedParts;
      expect(text).toContain('https://app.example.test/invite/tok_123');
      expect(html).toContain('Example &lt;d.o.o.&gt;');
      const subject = /^Subject: (.+(?:\r\n .+)*)/m.exec(raw)![1]!;
      const decodedSubject = subject
        .split(/\s+/)
        .map((word) => Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(word)![1]!, 'base64').toString('utf8'))
        .join('');
      expect(decodedSubject).toBe('You are invited to Example <d.o.o.> on NestSelf');
    } finally {
      ses.restore();
    }
  });
});
