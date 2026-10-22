/**
 * InvitationsModule — invitation creation, import, revocation, preview and
 * acceptance (T-1.5). Controllers and services are added by the feature.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationActivationController } from './invitation-activation.controller.js';
import { InvitationsService } from './invitations.service.js';
import { InvitationActivationService } from './invitation-activation.service.js';
import {
  InvitationMailer,
  LoggingInvitationMailer,
} from './invitation-mailer.js';
import { SesInvitationMailer } from './ses-invitation-mailer.js';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [InvitationsController, InvitationActivationController],
  providers: [
    InvitationsService,
    InvitationActivationService,
    {
      // SES when a verified sender is configured (D-29); otherwise log the link.
      provide: InvitationMailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService): InvitationMailer => {
        const fromEmail = config.get<string>('SES_FROM_EMAIL');
        if (fromEmail && config.get<string>('NODE_ENV') !== 'test') {
          return new SesInvitationMailer({
            fromEmail,
            region: config.get<string>('COGNITO_REGION') ?? 'eu-central-1',
            workspaceUrl: config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173',
          });
        }
        return new LoggingInvitationMailer(config);
      },
    },
  ],
})
export class InvitationsModule {}
