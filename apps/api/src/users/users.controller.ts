/**
 * UsersController — operations-level user suspension endpoints (T-1.18).
 *
 * POST /ops/users/:userId/suspend
 * POST /ops/users/:userId/reinstate
 *
 * @see API-R-27, API-R-28
 */
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ACTIONS,
  UserSuspendRequestSchema,
  type UserSuspendRequest,
  type UserSuspendResponse,
  type UserReinstateResponse,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsResource } from '../authz/resolvers.js';
import type { Principal } from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { UsersService } from './users.service.js';

@Controller('ops/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':userId/suspend')
  @HttpCode(200)
  @Authorize(
    ACTIONS['people.deactivate'],
    operationsResource('user', (req) => (req['params'] as Record<string, string>)['userId']),
  )
  async suspendUser(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(UserSuspendRequestSchema)) body: UserSuspendRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<UserSuspendResponse> {
    return this.usersService.suspendUser(userId, body, principal.userId);
  }

  @Post(':userId/reinstate')
  @HttpCode(200)
  @Authorize(
    ACTIONS['people.deactivate'],
    operationsResource('user', (req) => (req['params'] as Record<string, string>)['userId']),
  )
  async reinstateUser(
    @Param('userId') userId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<UserReinstateResponse> {
    return this.usersService.reinstateUser(userId, principal.userId);
  }
}
