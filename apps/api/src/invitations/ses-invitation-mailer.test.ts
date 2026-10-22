import { describe, it, expect, vi } from 'vitest';
import { SesInvitationMailer } from './ses-invitation-mailer.js';

describe('SesInvitationMailer', () => {
  it('sends a plain-text and HTML email with the activation link', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mailer = new SesInvitationMailer({
      fromEmail: 'no-reply@example.test',
      region: 'eu-central-1',
      workspaceUrl: 'https://app.example.test',
      client: { send },
    });

    await mailer.send({
      email: 'invitee@example.test',
      token: 'tok_123',
      organizationName: 'Example <d.o.o.>',
      inviterDisplayName: 'Ivana',
    });

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]![0] as { input: Record<string, never> };
    const input = command.input as unknown as {
      Source: string;
      Destination: { ToAddresses: string[] };
      Message: { Subject: { Data: string }; Body: { Text: { Data: string }; Html: { Data: string } } };
    };
    expect(input.Source).toBe('no-reply@example.test');
    expect(input.Destination.ToAddresses).toEqual(['invitee@example.test']);
    expect(input.Message.Body.Text.Data).toContain('https://app.example.test/invitations/tok_123');
    expect(input.Message.Body.Html.Data).toContain('Example &lt;d.o.o.&gt;');
    expect(input.Message.Subject.Data).toContain('Example <d.o.o.>');
  });

  it('propagates SES failures so the caller can log them', async () => {
    const send = vi.fn().mockRejectedValue(new Error('MessageRejected'));
    const mailer = new SesInvitationMailer({
      fromEmail: 'no-reply@example.test',
      region: 'eu-central-1',
      workspaceUrl: 'https://app.example.test',
      client: { send },
    });
    await expect(
      mailer.send({ email: 'a@b.test', token: 't', organizationName: 'O', inviterDisplayName: 'I' }),
    ).rejects.toThrow('MessageRejected');
  });
});
