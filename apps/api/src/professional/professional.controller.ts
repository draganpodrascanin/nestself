/**
 * ProfessionalController: the confidential professional-interaction routes
 * (T-2.4, CONF-R-03). Every route is `@Authenticated()`; authorization needs
 * the row (case id, organization, employee), so the service loads it and
 * calls `AuthorizationService.require` before returning anything.
 *
 * GET /professional/conversations         assigned expert's list (metadata only)
 * GET /professional/me/conversations      participant's list (metadata only)
 * GET /professional/conversations/:id     assigned expert (conversation.read.assigned)
 * GET /professional/me/conversations/:id  participant (conversation.participate)
 * GET /professional/intake/:id            assigned expert (conversation.read.assigned)
 */
import { Controller, Get, Param } from '@nestjs/common';
import type { ConversationListResponse, Principal } from '@nestself/contracts';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ProfessionalService, type ConversationView, type IntakeView } from './professional.service.js';

@Controller('professional')
export class ProfessionalController {
  constructor(private readonly professional: ProfessionalService) {}

  @Get('conversations')
  @Authenticated()
  listAssignedConversations(@CurrentPrincipal() principal: Principal): Promise<ConversationListResponse> {
    return this.professional.listAssignedConversations(principal);
  }

  @Get('me/conversations')
  @Authenticated()
  listOwnConversations(@CurrentPrincipal() principal: Principal): Promise<ConversationListResponse> {
    return this.professional.listOwnConversations(principal);
  }

  @Get('conversations/:id')
  @Authenticated()
  readAssignedConversation(
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ConversationView> {
    return this.professional.readAssignedConversation(principal, id);
  }

  @Get('me/conversations/:id')
  @Authenticated()
  readOwnConversation(
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ConversationView> {
    return this.professional.readOwnConversation(principal, id);
  }

  @Get('intake/:id')
  @Authenticated()
  readAssignedIntake(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<IntakeView> {
    return this.professional.readAssignedIntake(principal, id);
  }
}
