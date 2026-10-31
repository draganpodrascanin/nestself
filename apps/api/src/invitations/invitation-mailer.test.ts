/**
 * The invitation mailer delegates to the generalised mailer (T-CW-1.3 step 6).
 * The SES assertions moved here from the former `ses-invitation-mailer.test.ts`.
 */
import { SendRawEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Mailer } from '../mailer/mailer.js';
import { SesMailer } from '../mailer/ses-mailer.js';
import { MailerInvitationMailer } from './invitation-mailer.js';

const INVITATION = {
  email: 'invitee@example.test',
  token: 'tok_123',
  organizationName: 'Example <d.o.o.>',
  inviterDisplayName: 'Ivana',
};

function fakeMailer(): Mailer & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue(undefined) } as unknown as Mailer & { send: ReturnType<typeof vi.fn> };
}

describe('MailerInvitationMailer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the invitation template with the activation link through the mailer', async () => {
    const mailer = fakeMailer();
    await new MailerInvitationMailer(mailer, 'https://app.example.test').send(INVITATION);
    expect(mailer.send).toHaveBeenCalledExactlyOnceWith({
      to: 'invitee@example.test',
      locale: 'en',
      template: 'invitation',
      data: {
        organizationName: 'Example <d.o.o.>',
        inviterDisplayName: 'Ivana',
        activationUrl: 'https://app.example.test/invitations/tok_123',
      },
    });
  });

  it("uses the invitee's locale when the invitation carries one", async () => {
    const mailer = fakeMailer();
    await new MailerInvitationMailer(mailer, 'https://app.example.test').send({ ...INVITATION, locale: 'sr-Latn' });
    expect(mailer.send.mock.calls[0]![0]).toMatchObject({ locale: 'sr-Latn' });
  });

  it('propagates mailer failures so the caller can log them', async () => {
    const mailer = fakeMailer();
    mailer.send.mockRejectedValue(new Error('MessageRejected'));
    await expect(new MailerInvitationMailer(mailer, 'https://app.example.test').send(INVITATION)).rejects.toThrow(
      'MessageRejected',
    );
  });

  it('sends a plain-text and HTML email with the activation link through SES', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const ses = mockClient(SESClient);
    ses.on(SendRawEmailCommand).resolves({ MessageId: 'msg-1' });
    try {
      const mailer = new SesMailer({ fromEmail: 'no-reply@example.test', region: 'eu-central-1' });
      await new MailerInvitationMailer(mailer, 'https://app.example.test').send(INVITATION);

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
      expect(text).toContain('https://app.example.test/invitations/tok_123');
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
