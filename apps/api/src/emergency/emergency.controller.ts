/**
 * EmergencyController: emergency access to restricted professional records
 * from the operations workspace (T-2.5, 5.4, API-R-26, CONF-R-09).
 *
 * GET  /ops/emergency-access                                   list records (audit.read)
 * POST /ops/emergency-access                                   request (access.emergency.request)
 * POST /ops/emergency-access/:id/approve                       approve, different user (access.emergency.approve)
 * POST /ops/emergency-access/:id/deny                          deny, deletes the request (access.emergency.approve)
 * POST /ops/emergency-access/:id/revoke                        revoke (access.emergency.approve)
 * GET  /ops/emergency-access/:id/records/:recordType/:recordId one record (records.read.emergency, in the service)
 *
 * Request and approval carry the `emergency` step-up class through the
 * guard. The record read needs the loaded row to authorize, so it is
 * `@Authenticated()` and the service calls `AuthorizationService.require`.
 * There is no list of records (CONF-R-09). Writes are throttled to 10 per
 * minute per route.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  ACTIONS,
  EmergencyAccessCreateRequestSchema,
  EmergencyRecordTypeSchema,
  type EmergencyAccessCreateRequest,
  type EmergencyAccessListResponse,
  type EmergencyAccessResponse,
  type EmergencyRecordResponse,
  type EmergencyRecordType,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { operationsResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { EmergencyService } from './emergency.service.js';

const EmergencyAccessListQuerySchema = z.object({ userId: z.string().min(1).optional() });
type EmergencyAccessListQuery = z.infer<typeof EmergencyAccessListQuerySchema>;

const routeId = (req: Record<string, unknown>): string | undefined =>
  (req['params'] as Record<string, string | undefined> | undefined)?.['id'];

@Controller('ops/emergency-access')
export class EmergencyController {
  constructor(private readonly emergency: EmergencyService) {}

  @Get()
  @Authorize(ACTIONS['audit.read'], operationsResource('emergency_access'))
  list(
    @Query(new ZodValidationPipe(EmergencyAccessListQuerySchema)) query: EmergencyAccessListQuery,
  ): Promise<EmergencyAccessListResponse> {
    return this.emergency.list(query);
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.emergency.request'], operationsResource('emergency_access'))
  request(
    @Body(new ZodValidationPipe(EmergencyAccessCreateRequestSchema)) body: EmergencyAccessCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<EmergencyAccessResponse> {
    return this.emergency.request(body, principal);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.emergency.approve'], operationsResource('emergency_access', routeId))
  approve(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<EmergencyAccessResponse> {
    return this.emergency.approve(id, principal);
  }

  @Post(':id/deny')
  @HttpCode(204)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.emergency.approve'], operationsResource('emergency_access', routeId))
  deny(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<void> {
    return this.emergency.deny(id, principal);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.emergency.approve'], operationsResource('emergency_access', routeId))
  revoke(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<EmergencyAccessResponse> {
    return this.emergency.revoke(id, principal);
  }

  @Get(':id/records/:recordType/:recordId')
  @Authenticated()
  readRecord(
    @Param('id') id: string,
    @Param('recordType', new ZodValidationPipe(EmergencyRecordTypeSchema)) recordType: EmergencyRecordType,
    @Param('recordId') recordId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<EmergencyRecordResponse> {
    return this.emergency.readRecord(principal, id, recordType, recordId);
  }
}
