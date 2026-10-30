/**
 * Invitation email sending abstraction [D-03, D-29].
 *
 * `InvitationMailer` is the abstract DI token. With SES configured,
 * `MailerInvitationMailer` sends the `invitation` template through the
 * generalised `Mailer` (T-CW-1.3, guidelines 10.1: no parallel
 * implementation). Without SES, `LoggingInvitationMailer` logs the invitation
 * link at debug level in non-production, so a developer can activate an
 * invitation locally, and never logs the raw token in production.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { type Locale } from '@nestself/contracts';
import { type Mailer } from '../mailer/mailer.js';

export interface InvitationMailInput {
  email: string;
  token: string;
  organizationName: string;
  inviterDisplayName: string;
  /** Invitations carry no locale yet; English until they do (D-10). */
  locale?: Locale;
}

export abstract class InvitationMailer {
  abstract send(input: InvitationMailInput): Promise<void>;
}

@Injectable()
export class LoggingInvitationMailer extends InvitationMailer {
  private readonly logger = new Logger(LoggingInvitationMailer.name);
  private readonly workspaceUrl: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    super();
    this.workspaceUrl = config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173';
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  async send(input: InvitationMailInput): Promise<void> {
    if (this.isProduction) {
      // Never log the token in production (D-03).
      this.logger.debug(
        `Invitation email for ${input.email} to ${input.organizationName} (token redacted)`,
      );
      return;
    }

    const link = `${this.workspaceUrl}/invitations/${input.token}`;
    this.logger.debug(
      `Invitation link for ${input.email}: ${link}`,
    );
  }
}

/** Sends the invitation through the generalised mailer (T-CW-1.3 step 6). */
export class MailerInvitationMailer extends InvitationMailer {
  constructor(
    private readonly mailer: Mailer,
    private readonly workspaceUrl: string,
  ) {
    super();
  }

  async send(input: InvitationMailInput): Promise<void> {
    await this.mailer.send({
      to: input.email,
      locale: input.locale ?? 'en',
      template: 'invitation',
      data: {
        organizationName: input.organizationName,
        inviterDisplayName: input.inviterDisplayName,
        activationUrl: `${this.workspaceUrl}/invitations/${input.token}`,
      },
    });
  }
}
