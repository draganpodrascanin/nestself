/**
 * MembersController — membership deactivation endpoint (T-1.16).
 *
 * POST /orgs/:orgId/members/:membershipId/end
 */
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ACTIONS,
  MemberEndRequestSchema,
  type MemberEndRequest,
  type MemberEndResponse,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import type { Principal } from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembersService } from './members.service.js';

@Controller('orgs/:orgId/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  /**
   * End a membership and cascade-revoke org-scoped grants.
   *
   * Annotated for step-up: the AuthorizationGuard sets `req.stepUpClass`
   * from `STEP_UP_CLASS_BY_ACTION` for `people.deactivate`; enforcement
   * is phase 2.
   */
  @Post(':membershipId/end')
  @HttpCode(200)
  @Authorize(ACTIONS['people.deactivate'], orgResourceFromContext('membership'))
  async endMembership(
    @Param('orgId') orgId: string,
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(MemberEndRequestSchema)) body: MemberEndRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<MemberEndResponse> {
    return this.membersService.endMembership(
      orgId,
      membershipId,
      body,
      principal.userId,
    );
  }
}
