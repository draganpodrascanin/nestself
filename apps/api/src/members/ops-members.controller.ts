/**
 * OpsMembersController — membership administration for assigned clients,
 * reached from the operations workspace (T-2.0).
 *
 * GET  /ops/orgs/:orgId/members                    — list (client.configure)
 * POST /ops/orgs/:orgId/members/:membershipId/end  — end (people.deactivate)
 *
 * `operationsOrgResource` requires a web session in the operations context;
 * `authorize()` then limits `assigned_clients` grants to organizations the
 * caller holds a CLIENT assignment for.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ACTIONS,
  MemberEndRequestSchema,
  MemberListQuerySchema,
  type MemberEndRequest,
  type MemberEndResponse,
  type MemberListQuery,
  type MemberListResponse,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsOrgResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembersService } from './members.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembersAdminService } from './members-admin.service.js';

@Controller('ops/orgs/:orgId/members')
export class OpsMembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly membersAdminService: MembersAdminService,
  ) {}

  @Get()
  @Authorize(ACTIONS['client.configure'], operationsOrgResource('membership'))
  async list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(MemberListQuerySchema)) query: MemberListQuery,
  ): Promise<MemberListResponse> {
    return this.membersAdminService.listMembers(orgId, query);
  }

  /** Step-up class "administration" is stamped by the guard (phase 2 enforcement). */
  @Post(':membershipId/end')
  @HttpCode(200)
  @Authorize(ACTIONS['people.deactivate'], operationsOrgResource('membership'))
  async endMembership(
    @Param('orgId') orgId: string,
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(MemberEndRequestSchema)) body: MemberEndRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<MemberEndResponse> {
    return this.membersService.endMembership(orgId, membershipId, body, principal.userId);
  }
}
