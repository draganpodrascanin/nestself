/**
 * SES implementation of the invitation mailer [D-29].
 *
 * Selected by InvitationsModule when `SES_FROM_EMAIL` is configured and
 * `NODE_ENV` is not `test`. Sends a plain-text and HTML email with the
 * activation link; the token appears only in the link, never in logs.
 *
 * Templates are English for now; localisation per invitee follows the
 * CustomMessage trigger locale work (D-10) once invitations carry a locale.
 */
import { Injectable, Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { InvitationMailer, type InvitationMailInput } from './invitation-mailer.js';

export interface SesInvitationMailerOptions {
  fromEmail: string;
  region: string;
  workspaceUrl: string;
  /** Injected in tests; defaults to a real SES client. */
  client?: Pick<SESClient, 'send'>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

@Injectable()
export class SesInvitationMailer extends InvitationMailer {
  private readonly logger = new Logger(SesInvitationMailer.name);
  private readonly client: Pick<SESClient, 'send'>;

  constructor(private readonly options: SesInvitationMailerOptions) {
    super();
    this.client = options.client ?? new SESClient({ region: options.region });
  }

  async send(input: InvitationMailInput): Promise<void> {
    const link = `${this.options.workspaceUrl}/invitations/${input.token}`;
    const subject = `You are invited to ${input.organizationName} on NestSelf`;
    const text = [
      `${input.inviterDisplayName} invited you to join ${input.organizationName} on NestSelf.`,
      '',
      `Open this link to activate your access: ${link}`,
      '',
      'The link is valid for 7 days. If you did not expect this invitation, you can ignore this email.',
    ].join('\n');
    const html = [
      `<p>${escapeHtml(input.inviterDisplayName)} invited you to join <strong>${escapeHtml(input.organizationName)}</strong> on NestSelf.</p>`,
      `<p><a href="${escapeHtml(link)}">Activate your access</a></p>`,
      '<p>The link is valid for 7 days. If you did not expect this invitation, you can ignore this email.</p>',
    ].join('');

    await this.client.send(
      new SendEmailCommand({
        Source: this.options.fromEmail,
        Destination: { ToAddresses: [input.email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            Html: { Data: html, Charset: 'UTF-8' },
          },
        },
      }),
    );
    this.logger.log(`Invitation email sent for organization ${input.organizationName}`);
  }
}
