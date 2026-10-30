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
import { OpsInvitationsController } from './ops-invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { InvitationActivationService } from './invitation-activation.service.js';
import { Mailer } from '../mailer/mailer.js';
import { MailerModule, sesMailerOptions } from '../mailer/mailer.module.js';
import {
  InvitationMailer,
  LoggingInvitationMailer,
  MailerInvitationMailer,
} from './invitation-mailer.js';

@Module({
  imports: [AuthModule, IdentityModule, MailerModule],
  controllers: [InvitationsController, InvitationActivationController, OpsInvitationsController],
  providers: [
    InvitationsService,
    InvitationActivationService,
    {
      // SES through the generalised mailer when a verified sender is
      // configured (D-29, T-CW-1.3); otherwise log the link for development.
      provide: InvitationMailer,
      inject: [ConfigService, Mailer],
      useFactory: (config: ConfigService, mailer: Mailer): InvitationMailer =>
        sesMailerOptions(config)
          ? new MailerInvitationMailer(mailer, config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173')
          : new LoggingInvitationMailer(config),
    },
  ],
})
export class InvitationsModule {}
