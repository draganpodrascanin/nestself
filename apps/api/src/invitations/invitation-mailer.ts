/**
 * Invitation email sending abstraction [D-03, D-29].
 *
 * `InvitationMailer` is the abstract DI token. The default implementation
 * (`LoggingInvitationMailer`) logs the invitation link at debug level
 * in non-production and never logs the raw token in production.
 *
 * TODO(D-29): Add a real SES implementation that sends the templated email.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';

export interface InvitationMailInput {
  email: string;
  token: string;
  organizationName: string;
  inviterDisplayName: string;
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
