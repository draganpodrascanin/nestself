/**
 * CmsController -- M1 content workflow endpoints (T-C1.10, 7.11).
 *
 * POST   /api/ops/cms/resources           -- create resource
 * GET    /api/ops/cms/resources           -- list (category-scoped)
 * GET    /api/ops/cms/resources/:id       -- detail
 * POST   /api/ops/cms/resources/:id/variants -- add missing locale variant
 * PUT    /api/ops/cms/variants/:variantId/revisions/:revisionId -- save
 * POST   /api/ops/cms/variants/:variantId/revisions             -- new working rev
 * POST   /api/ops/cms/revisions/:revisionId/submit  -- submit for review
 * POST   /api/ops/cms/revisions/:revisionId/approve -- approve
 * POST   /api/ops/cms/publications                  -- publish now
 *
 * Authorization: create uses @Authorize (collectionId from body); list uses
 * operationsCategoryScope; all other routes use @Authenticated + manual scope
 * check because the collectionId requires a database lookup that plain
 * resolver functions cannot perform (no DI access).
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
} from '@nestjs/common';
import type { Principal, Action } from '@nestself/contracts';
import {
  ACTIONS,
  ResourceCreateRequestSchema,
  type ResourceCreateRequest,
  RevisionUpdateRequestSchema,
  type RevisionUpdateRequest,
  VariantCreateRequestSchema,
  type VariantCreateRequest,
  ReviewDecisionRequestSchema,
  type ReviewDecisionRequest,
  PublicationCreateRequestSchema,
  type PublicationCreateRequest,
  ResourceListQuerySchema,
  type ResourceListQuery,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { operationsCategoryScope } from '../authz/operations-category-scope.js';
import { assertOperationsSession } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiHttpException } from '../common/api-error.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsService } from './cms.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsScopeService } from '../authz/cms-scope.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsResourceLoader } from './cms-resource-loader.js';

// ---------------------------------------------------------------------------
// Resolver for the create endpoint (collectionId from request body)
// ---------------------------------------------------------------------------

function cmsCreateResolver(req: Record<string, unknown>, principal: Principal) {
  assertOperationsSession(principal);
  const body = req['body'] as Record<string, unknown> | undefined;
  const categoryId = body?.primaryCategoryId as string | undefined;
  if (!categoryId) {
    throw new ApiHttpException({
      status: 400,
      code: 'content_missing_required',
      message: 'primaryCategoryId is required',
    });
  }
  return { type: 'content_resource', id: '', collectionId: categoryId };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('ops/cms')
export class CmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly cmsScopeService: CmsScopeService,
    private readonly cmsResourceLoader: CmsResourceLoader,
  ) {}

  // ── Shared helpers ──────────────────────────────────────────────────

  /**
   * Enforce that the principal has the given action on the resource's category.
   * Throws 404 when the resource is not found (or not scoped to the caller).
   */
  private async enforceCategoryScope(
    principal: Principal,
    action: Action,
    collectionId: string | null,
  ): Promise<void> {
    if (!collectionId) return; // platform-scoped resources pass through
    const allowed = await this.cmsScopeService.allowedCategoryIds(principal, action);
    if (!allowed.includes(collectionId)) {
      // Return 404 rather than 403 to avoid leaking existence.
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
  }

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
  @Authorize(ACTIONS['content.preview'], operationsCategoryScope('content_resource', { list: true }))
  async listResources(
    @Query(new ZodValidationPipe(ResourceListQuerySchema)) query: ResourceListQuery,
    @CurrentPrincipal() principal: Principal,
  ) {
    let categoryIds: string[];
    if (query.categoryId) {
      categoryIds = [query.categoryId];
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
    return this.cmsService.listResources(categoryIds, query);
  }

  @Get('resources/:resourceId')
  @Authenticated()
  async getResource(
    @Param('resourceId') resourceId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertOperationsSession(principal);
    const resource = await this.cmsResourceLoader.forResource(resourceId);
    if (!resource) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    await this.enforceCategoryScope(principal, ACTIONS['content.preview'], resource.collectionId);

    const detail = await this.cmsService.getResourceDetail(resourceId);
    if (!detail) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    return detail;
  }

  // ─── Variants ───────────────────────────────────────────────────────

  @Post('resources/:resourceId/variants')
  @Authenticated()
  @HttpCode(HttpStatus.CREATED)
  async addVariant(
    @Param('resourceId') resourceId: string,
    @Body(new ZodValidationPipe(VariantCreateRequestSchema)) body: VariantCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertOperationsSession(principal);
    const resource = await this.cmsResourceLoader.forResource(resourceId);
    if (!resource) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    await this.enforceCategoryScope(principal, ACTIONS['content.write'], resource.collectionId);

    return this.cmsService.addVariant(resourceId, body.locale, principal);
  }

  // ─── Revisions ──────────────────────────────────────────────────────

  @Put('variants/:variantId/revisions/:revisionId')
  @Authenticated()
  async saveRevision(
    @Param('variantId') variantId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(RevisionUpdateRequestSchema)) body: RevisionUpdateRequest,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertOperationsSession(principal);

    // Resolve resource for authorization
    const loaded = await this.cmsResourceLoader.forRevision(revisionId);
    if (!loaded) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
    }
    await this.enforceCategoryScope(principal, ACTIONS['content.write'], loaded.collectionId);

    if (!ifMatch) {
      throw new ApiHttpException({
        status: 428,
        code: 'content_missing_required',
        message: 'If-Match header is required for revision updates',
      });
    }

    // Parse the ETag value: strip quotes
    const versionStr = ifMatch.replace(/^"/, '').replace(/"$/, '');
    const lockVersion = parseInt(versionStr, 10);
    if (Number.isNaN(lockVersion)) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: 'If-Match header must contain a numeric lock version',
      });
    }

    const result = await this.cmsService.saveRevision(variantId, revisionId, body, lockVersion, principal);
    return { ...result, _etag: `"${(result as { lockVersion: number }).lockVersion}"` };
  }

  @Post('variants/:variantId/revisions')
  @Authenticated()
  @HttpCode(HttpStatus.CREATED)
  async createNewRevision(
    @Param('variantId') variantId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertOperationsSession(principal);

    // Look up the resource for the variant to check scope
    const resource = await this.cmsResourceLoader.forVariant(variantId);
    if (!resource) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Variant not found' });
    }
    await this.enforceCategoryScope(principal, ACTIONS['content.write'], resource.collectionId);

    return this.cmsService.createNewWorkingRevision(variantId, principal);
  }

  // ─── Review ─────────────────────────────────────────────────────────

  @Post('revisions/:revisionId/submit')
  @HttpCode(HttpStatus.OK)
  @Authenticated()
  async submitRevision(
    @Param('revisionId') revisionId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertOperationsSession(principal);

    const loaded = await this.cmsResourceLoader.forRevision(revisionId);
    if (!loaded) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
    }
    await this.enforceCategoryScope(principal, ACTIONS['content.submit'], loaded.collectionId);

    return this.cmsService.submitRevision(revisionId, principal);
  }

  @Post('revisions/:revisionId/approve')
  @HttpCode(HttpStatus.OK)
  @Authenticated()
  async approveRevision(
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(ReviewDecisionRequestSchema)) body: ReviewDecisionRequest,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertOperationsSession(principal);

    const loaded = await this.cmsResourceLoader.forRevision(revisionId, { forReview: true });
    if (!loaded) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
    }
    await this.enforceCategoryScope(principal, ACTIONS['content.review'], loaded.collectionId);

    return this.cmsService.approveRevision(revisionId, principal, body.comment);
  }

  // ─── Publications ───────────────────────────────────────────────────

  @Post('publications')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent('content.publish')
  @Authenticated()
  async publishNow(
    @Body(new ZodValidationPipe(PublicationCreateRequestSchema)) body: PublicationCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertOperationsSession(principal);

    const resource = await this.cmsResourceLoader.forResource(body.resourceId);
    if (!resource) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    await this.enforceCategoryScope(principal, ACTIONS['content.publish'], resource.collectionId);

    return this.cmsService.publishNow(body, principal);
  }
}
