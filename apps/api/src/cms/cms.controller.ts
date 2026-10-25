/**
 * CmsController -- M1 content workflow endpoints (T-C1.10, 7.11).
 *
 * POST   /api/ops/cms/resources           -- create resource
 * GET    /api/ops/cms/resources           -- list (category-scoped)
 * GET    /api/ops/cms/resources/:resourceId       -- detail
 * POST   /api/ops/cms/resources/:resourceId/variants -- add missing locale variant
 * PUT    /api/ops/cms/variants/:variantId/revisions/:revisionId -- save
 * POST   /api/ops/cms/variants/:variantId/revisions             -- new working rev
 * POST   /api/ops/cms/revisions/:revisionId/submit  -- submit for review
 * POST   /api/ops/cms/revisions/:revisionId/approve -- approve
 * POST   /api/ops/cms/publications                  -- publish now
 *
 * Media routes (GET /media/:assetId, GET /media/:assetId/:rendition) live
 * in MediaOpsController to avoid duplication.
 *
 * Authorization: every route uses @Authorize() with engine-backed resolvers
 * from cms-resolvers.ts. Item routes use denyAs: 'not_found' (ACC-R-22/23).
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';

interface HttpRes {
  setHeader(name: string, value: string | string[]): void;
}
import type { Principal } from '@nestself/contracts';
import {
  ACTIONS,
  ResourceCreateRequestSchema,
  type ResourceCreateRequest,
  RevisionUpdateRequestSchema,
  type RevisionUpdateRequest,
  VariantCreateRequestSchema,
  type VariantCreateRequest,
  PublicationCreateRequestSchema,
  type PublicationCreateRequest,
  ResourceListQuerySchema,
  type ResourceListQuery,
  ReviewDecisionRequestSchema,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiHttpException } from '../common/api-error.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import {
  cmsResource,
  cmsCreateResolver,
  cmsPublishResolver,
  cmsList,
} from './cms-resolvers.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsService } from './cms.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsScopeService } from '../authz/cms-scope.service.js';

// ---------------------------------------------------------------------------
// Strict ETag helpers
// ---------------------------------------------------------------------------

const ETAG_RE = /^"(\d+)"$/;

function parseIfMatch(header: string | undefined): number {
  if (!header) {
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message: 'If-Match header is required for revision updates',
      details: { header: 'If-Match' },
    });
  }
  const m = ETAG_RE.exec(header);
  if (!m) {
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message: 'If-Match must be a quoted integer, e.g. "1"',
    });
  }
  return parseInt(m[1]!, 10);
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('ops/cms')
export class CmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly cmsScopeService: CmsScopeService,
  ) {}

  // ─── Resources ──────────────────────────────────────────────────────

  @Post('resources')
  @HttpCode(HttpStatus.CREATED)
  @Authorize(ACTIONS['content.write'], cmsCreateResolver)
  async createResource(
    @Body(new ZodValidationPipe(ResourceCreateRequestSchema)) body: ResourceCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.cmsService.createResource(body, principal);
  }

  @Get('resources')
  @Authorize(ACTIONS['content.preview'], cmsList('content_resource', ACTIONS['content.preview']))
  async listResources(
    @Query(new ZodValidationPipe(ResourceListQuerySchema)) query: ResourceListQuery,
    @CurrentPrincipal() principal: Principal,
    @Req() req: Record<string, unknown>,
  ) {
    let categoryIds: string[];
    if (query.categoryId) {
      categoryIds = [query.categoryId];
    } else {
      // Re-use the allowed set stashed by the cmsList resolver (avoids second DB call)
      const stashed = req['_cmsAllowedCategoryIds'] as string[] | undefined;
      if (stashed && stashed.length > 0) {
        categoryIds = stashed;
      } else {
        const allowed = await this.cmsScopeService.allowedCategoryIds(
          principal,
          ACTIONS['content.preview'],
        );
        if (allowed.length === 0) {
          throw new ApiHttpException({
            status: 403,
            code: 'forbidden',
            message: 'No accessible categories',
          });
        }
        categoryIds = allowed;
      }
    }
    return this.cmsService.listResources(categoryIds, query);
  }

  @Get('resources/:resourceId')
  @Authorize(
    ACTIONS['content.preview'],
    cmsResource('forResource', 'resourceId'),
    { denyAs: 'not_found' },
  )
  async getResource(
    @Param('resourceId') resourceId: string,
  ) {
    const detail = await this.cmsService.getResourceDetail(resourceId);
    if (!detail) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    return detail;
  }

  // ─── Variants ───────────────────────────────────────────────────────

  @Post('resources/:resourceId/variants')
  @HttpCode(HttpStatus.CREATED)
  @Authorize(
    ACTIONS['content.write'],
    cmsResource('forResource', 'resourceId'),
    { denyAs: 'not_found' },
  )
  async addVariant(
    @Param('resourceId') resourceId: string,
    @Body(new ZodValidationPipe(VariantCreateRequestSchema)) body: VariantCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.cmsService.addVariant(resourceId, body.locale, principal, body.fromLocale);
  }

  // ─── Revisions ──────────────────────────────────────────────────────

  @Put('variants/:variantId/revisions/:revisionId')
  @Authorize(
    ACTIONS['content.write'],
    cmsResource('forRevision', 'revisionId'),
    { denyAs: 'not_found' },
  )
  async saveRevision(
    @Param('variantId') variantId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(RevisionUpdateRequestSchema)) body: RevisionUpdateRequest,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const lockVersion = parseIfMatch(ifMatch);
    const result = await this.cmsService.saveRevision(variantId, revisionId, body, lockVersion, principal);
    res.setHeader('ETag', `"${(result as { lockVersion: number }).lockVersion}"`);
    return result;
  }

  @Post('variants/:variantId/revisions')
  @HttpCode(HttpStatus.CREATED)
  @Authorize(
    ACTIONS['content.write'],
    cmsResource('forVariant', 'variantId'),
    { denyAs: 'not_found' },
  )
  async createNewRevision(
    @Param('variantId') variantId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.cmsService.createNewWorkingRevision(variantId, principal);
  }

  // ─── Review ─────────────────────────────────────────────────────────

  @Post('revisions/:revisionId/submit')
  @HttpCode(HttpStatus.OK)
  @Authorize(
    ACTIONS['content.submit'],
    cmsResource('forRevision', 'revisionId'),
    { denyAs: 'not_found' },
  )
  async submitRevision(
    @Param('revisionId') revisionId: string,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const result = await this.cmsService.submitRevision(revisionId, principal);
    if (result && typeof (result as Record<string, unknown>).lockVersion === 'number') {
      res.setHeader('ETag', `"${(result as { lockVersion: number }).lockVersion}"`);
    }
    return result;
  }

  @Post('revisions/:revisionId/approve')
  @HttpCode(HttpStatus.OK)
  @Authorize(
    ACTIONS['content.review'],
    cmsResource('forRevision', 'revisionId', { review: true }),
    { denyAs: 'not_found' },
  )
  async approveRevision(
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(ReviewDecisionRequestSchema)) _body: unknown,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const result = await this.cmsService.approveRevision(revisionId, principal);
    if (result && typeof (result as Record<string, unknown>).lockVersion === 'number') {
      res.setHeader('ETag', `"${(result as { lockVersion: number }).lockVersion}"`);
    }
    return result;
  }

  // ─── Publications ───────────────────────────────────────────────────

  @Post('publications')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent('content.publish')
  @Authorize(ACTIONS['content.publish'], cmsPublishResolver, { denyAs: 'not_found' })
  async publishNow(
    @Body(new ZodValidationPipe(PublicationCreateRequestSchema)) body: PublicationCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.cmsService.publishNow(body, principal);
  }

  // Media routes live in MediaOpsController (media-ops.controller.ts)
  // to avoid duplication (must-fix 4).
}
