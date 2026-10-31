/**
 * InvitationsModule — invitation creation, import, revocation, preview and
 * acceptance (T-1.5). Controllers and services are added by the feature.
 *
 * Emails go through the global `MailerModule`'s `Mailer` (SES or logging).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationActivationController } from './invitation-activation.controller.js';
import { OpsInvitationsController } from './ops-invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { InvitationActivationService } from './invitation-activation.service.js';
import { InvitationMailer } from './invitation-mailer.js';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [InvitationsController, InvitationActivationController, OpsInvitationsController],
  providers: [InvitationsService, InvitationActivationService, InvitationMailer],
})
export class InvitationsModule {}
