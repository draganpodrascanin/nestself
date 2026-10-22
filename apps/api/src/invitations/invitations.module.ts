/**
 * InvitationsModule — invitation creation, import, revocation, preview and
 * acceptance (T-1.5). Controllers and services are added by the feature.
 */
import { Module } from '@nestjs/common';
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

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [InvitationsController, InvitationActivationController],
  providers: [
    InvitationsService,
    InvitationActivationService,
    { provide: InvitationMailer, useClass: LoggingInvitationMailer },
  ],
})
export class InvitationsModule {}
