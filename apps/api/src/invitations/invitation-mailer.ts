/**
 * Invitation email sending [D-03, D-29].
 *
 * A thin caller of the shared {@link Mailer} port: it builds the activation
 * link from the workspace origin and hands the `invitation` template over.
 * Whether the mail goes out through SES or into the log is the port's
 * business (`EmailModule`); the token appears only in the link, never in logs.
 *
 * The invitation carries no locale yet, so it is sent in the platform default
 * (`sr-Latn`); the template exists in all four locales for when it does.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mailer } from '../email/mailer.js';

export interface InvitationMailInput {
  email: string;
  token: string;
  organizationName: string;
  inviterDisplayName: string;
}

@Injectable()
export class InvitationMailer {
  private readonly workspaceUrl: string;

  constructor(
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.workspaceUrl = config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173';
  }

  async send(input: InvitationMailInput): Promise<void> {
    await this.mailer.send({
      to: input.email,
      locale: 'sr-Latn',
      template: 'invitation',
      params: {
        link: `${this.workspaceUrl}/invitations/${input.token}`,
        organizationName: input.organizationName,
        inviterDisplayName: input.inviterDisplayName,
      },
    });
  }
}
