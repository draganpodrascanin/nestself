/**
 * Invitation email sending [D-03, D-29].
 *
 * A thin caller of the generalised {@link Mailer} (T-CW-1.3, guidelines 10.1:
 * no parallel implementation): it builds the activation link from the
 * workspace origin and hands the `invitation` template over. Whether the mail
 * goes out through SES or into the log is the mailer's business
 * (`MailerModule`); the token appears only in the link, never in logs.
 *
 * The invitation carries no locale yet, so it is sent in the platform default
 * (`sr-Latn`) unless the caller passes one; the template exists in all four
 * locales for when it does (D-10).
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Locale } from '@nestself/contracts';
import { Mailer } from '../mailer/mailer.js';

export interface InvitationMailInput {
  email: string;
  token: string;
  organizationName: string;
  inviterDisplayName: string;
  /** The language of the mail; the platform default when the invitation carries none. */
  locale?: Locale;
}

/** Where the workspace serves the activation screen (`apps/workspace/src/routes/_public/invite.$token.tsx`). */
export const INVITE_PATH = '/invite/';

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
      locale: input.locale ?? 'sr-Latn',
      template: 'invitation',
      data: {
        organizationName: input.organizationName,
        inviterDisplayName: input.inviterDisplayName,
        activationUrl: `${this.workspaceUrl}${INVITE_PATH}${input.token}`,
      },
    });
  }
}
