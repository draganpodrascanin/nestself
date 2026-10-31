import { describe, expect, it, vi } from 'vitest';
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
  it('hands the invitation template, the platform default locale and the activation link to the Mailer', async () => {
    const { mailer, invitationMailer } = setup('https://app.example.test');

    await invitationMailer.send(INPUT);

    expect(mailer.send).toHaveBeenCalledOnce();
    expect(mailer.send).toHaveBeenCalledWith({
      to: 'invitee@example.test',
      locale: 'sr-Latn',
      template: 'invitation',
      params: {
        link: 'https://app.example.test/invite/tok_123',
        organizationName: 'Example <d.o.o.>',
        inviterDisplayName: 'Ivana',
      },
    });
  });

  it('builds the link on the local workspace origin when WORKSPACE_URL is unset', async () => {
    const { mailer, invitationMailer } = setup();

    await invitationMailer.send(INPUT);

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ link: 'http://localhost:5173/invite/tok_123' }),
      }),
    );
  });

  it('propagates a Mailer failure so the caller can log it', async () => {
    const { mailer, invitationMailer } = setup('https://app.example.test');
    mailer.send.mockRejectedValue(new Error('MessageRejected'));

    await expect(invitationMailer.send(INPUT)).rejects.toThrow('MessageRejected');
  });
});
