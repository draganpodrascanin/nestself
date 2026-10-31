/**
 * ApprovalController: follow-up approval items and the organization's
 * follow-up policy (T-CW-1.10, D-CW-37, guidelines 7.1).
 *
 * GET   /orgs/:orgId/appointment-approvals          approval.decide   orgResourceFromContext('appointment_approval')
 * POST  /appointment-approvals/:id/approve          approval.decide   approvalResource                10/60 s
 * POST  /appointment-approvals/:id/reject           approval.decide   approvalResource                10/60 s  { safeReason }
 * GET   /orgs/:orgId/settings/follow-up-approval    program.overview  orgResourceFromContext('organization')
 * PATCH /orgs/:orgId/settings/follow-up-approval    program.overview  orgResourceFromContext('organization')  5/60 s  { policy }
 *
 * The GET of the policy is not in the decision record's route list; the HR
 * settings screen needs it to show the current choice.
 *
 * Approve and reject answer the item as the approver sees it. Every
 * authorization denial and context mismatch answers 404 (CALL-17, D-CW-30;
 * `AppointmentNonDisclosureFilter`), except the self-approval refusal, which
 * only the item's own approver or alternate can meet: 403
 * `self_approval_denied`.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  AppointmentApprovalDecisionRequestSchema,
  FollowUpApprovalPolicyRequestSchema,
  type AppointmentApprovalDecisionRequest,
  type AppointmentApprovalItem,
  type AppointmentApprovalListResponse,
  type FollowUpApprovalPolicyRequest,
  type FollowUpApprovalPolicyResponse,
  type Principal,
} from '@nestself/contracts';
import { z } from 'zod';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppointmentNonDisclosureFilter } from './appointment-non-disclosure.filter.js';
import { approvalResource } from './approval.resolver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ApprovalService } from './approval.service.js';

/** HR policy writes: 5 per minute (guidelines 7.1). */
const POLICY_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

const ApproveRequestSchema = z.strictObject({});

@Controller()
@UseFilters(AppointmentNonDisclosureFilter)
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get('orgs/:orgId/appointment-approvals')
  @Authorize(ACTIONS['approval.decide'], orgResourceFromContext('appointment_approval'))
  list(@Param('orgId') orgId: string, @CurrentPrincipal() principal: Principal): Promise<AppointmentApprovalListResponse> {
    return this.approvals.list(orgId, principal);
  }

  @Post('appointment-approvals/:id/approve')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['approval.decide'], approvalResource)
  approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproveRequestSchema)) _body: unknown,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentApprovalItem> {
    return this.approvals.decide(id, principal, { decision: 'approve' });
  }

  @Post('appointment-approvals/:id/reject')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['approval.decide'], approvalResource)
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AppointmentApprovalDecisionRequestSchema)) body: AppointmentApprovalDecisionRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentApprovalItem> {
    return this.approvals.decide(id, principal, { decision: 'reject', reason: body.safeReason });
  }

  @Get('orgs/:orgId/settings/follow-up-approval')
  @Authorize(ACTIONS['program.overview'], orgResourceFromContext('organization'))
  getPolicy(@Param('orgId') orgId: string): Promise<FollowUpApprovalPolicyResponse> {
    return this.approvals.getPolicy(orgId);
  }

  @Patch('orgs/:orgId/settings/follow-up-approval')
  @Throttle(POLICY_THROTTLE)
  @Authorize(ACTIONS['program.overview'], orgResourceFromContext('organization'))
  setPolicy(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(FollowUpApprovalPolicyRequestSchema)) body: FollowUpApprovalPolicyRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FollowUpApprovalPolicyResponse> {
    return this.approvals.setPolicy(orgId, body.policy, principal);
  }
}
