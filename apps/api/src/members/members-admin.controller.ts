/**
 * MembersAdminController — member listing and update (5.3).
 *
 * GET   /orgs/:orgId/members              — list (program.overview or access.preview)
 * PATCH /orgs/:orgId/members/:membershipId — update (people.move)
 *
 * The existing MembersController already handles /orgs/:orgId/members
 * with POST routes (:membershipId/end); two controllers may share
 * the same path prefix.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ACTIONS,
  MemberListQuerySchema,
  MemberUpdateRequestSchema,
  type MemberItem,
  type MemberListQuery,
  type MemberListResponse,
  type MemberUpdateRequest,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembersAdminService } from './members-admin.service.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { Principal } from '@nestself/contracts';

@Controller('orgs/:orgId/members')
export class MembersAdminController {
  constructor(private readonly service: MembersAdminService) {}

  @Get()
  @Authorize(
    [ACTIONS['program.overview'], ACTIONS['access.preview']],
    orgResourceFromContext('membership'),
  )
  async list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(MemberListQuerySchema)) query: MemberListQuery,
  ): Promise<MemberListResponse> {
    return this.service.listMembers(orgId, query);
  }

  @Patch(':membershipId')
  @Authorize(ACTIONS['people.move'], orgResourceFromContext('membership'))
  async update(
    @Param('orgId') orgId: string,
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(MemberUpdateRequestSchema)) body: MemberUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<MemberItem> {
    return this.service.updateMember(orgId, membershipId, body, principal.userId);
  }
}
