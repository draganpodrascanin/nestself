/**
 * MediaOpsController — staff media endpoints under /api/ops/cms/media (8.12).
 *
 * POST   /api/ops/cms/media                 — upload (media.upload)
 * GET    /api/ops/cms/media                 — list (media.manage, category-scoped)
 * GET    /api/ops/cms/media/:assetId        — detail (media.manage, I4)
 * PUT    /api/ops/cms/media/:assetId        — update (media.manage, I4)
 * DELETE /api/ops/cms/media/:assetId        — delete (media.manage, I4)
 * GET    /api/ops/cms/media/:assetId/:rendition — preview (content.preview, I4)
 *
 * C2: Upload uses a custom multer StorageEngine that streams directly into
 *     quarantine, validates metadata fields, counts bytes, computes SHA-256,
 *     and sniffs magic bytes during the request.
 * C3: Delivery uses deliverRendition() for pipeline-based streaming.
 *
 * The upload requires `Content-Digest: sha-256=:<base64>:` per RFC 9530 (I1).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  MediaAssetUpdate,
  MediaListQuery,
  Principal,
} from '@nestself/contracts';
import {
  ACTIONS,
  MediaAssetUpdateSchema,
  MediaListQuerySchema,
  MediaRenditionKindSchema,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsResource, assertOperationsSession } from '../authz/resolvers.js';
import { operationsCategoryScope } from '../authz/operations-category-scope.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MediaService } from './media.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsScopeService } from '../authz/cms-scope.service.js';
import { MEDIA_STORAGE, type MediaStorage } from './storage/media-storage.js';
import { deliverRendition, type DeliverReq, type DeliverRes } from './deliver-rendition.js';
import type { UploadedAsset } from './upload-storage-engine.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsResourceLoader } from '../cms/cms-resource-loader.js';
import { cmsResource } from '../cms/cms-resolvers.js';

/** Minimal request shape (avoids `@types/express`). */
interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/** Minimal response shape (Express-compatible). */
interface HttpRes {
  setHeader(name: string, value: string | number): void;
  status(code: number): HttpRes;
  end(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

@Controller('ops/cms/media')
export class MediaOpsController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly cmsScopeService: CmsScopeService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    private readonly cmsResourceLoader: CmsResourceLoader,
  ) {}

  /**
   * Upload a media file via multipart/form-data.
   *
   * Metadata fields (kind, ownerCategoryId, licenseKind, etc.) must be sent
   * as form fields BEFORE the file part.  The request must include a
   * `Content-Digest: sha-256=:<base64>:` header per RFC 9530.
   *
   * Authorization note: the guard phase uses `@Authenticated()` because
   * NestJS guards run BEFORE interceptors.  FileInterceptor (multer)
   * populates `req.body` with multipart fields, but the guard can't read
   * them yet.  The category scope check runs in the custom
   * UploadStorageEngine after metadata parsing (C2, MED-R-33).  The
   * `assertOperationsSession()` call below verifies the session and
   * context at the handler level.
   */
  @Post()
  @Authenticated()
  @Idempotent('media.upload', {
    inFlightTtlSeconds: 900,
    fingerprintHeaders: ['content-digest'],
  })
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      files: 1,
      fields: 10,
      fieldSize: 4096,
      parts: 12,
      headerPairs: 50,
    },
  }))
  async upload(
    @UploadedFile() uploadedFile: UploadedAsset | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    // Guard phase only checked @Authenticated; verify operations context.
    assertOperationsSession(principal);

    if (uploadedFile && uploadedFile.assetId) {
      return {
        assetId: uploadedFile.assetId,
        state: uploadedFile.state,
      };
    }

    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message: 'No file provided in multipart request (expected field name "file")',
    });
  }

  @Get()
  @Authorize(ACTIONS['media.manage'], operationsCategoryScope('media_asset', { list: true }))
  async list(
    @Query(new ZodValidationPipe(MediaListQuerySchema)) query: MediaListQuery,
    @CurrentPrincipal() principal: Principal,
  ) {
    let categoryIds: string[] | null = null;

    if (query.categoryId) {
      categoryIds = [query.categoryId];
    } else {
      const allowed = await this.cmsScopeService.allowedCategoryIds(
        principal,
        ACTIONS['media.manage'],
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

    return this.mediaService.list(categoryIds, {
      kind: query.kind,
      state: query.state,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * Asset detail (I4): scoped through cmsResource resolver + denyAs:'not_found'.
   * Missing row → 404.  Out-of-scope → 404 (not 403).
   * In-scope + unready → detail is returned (not 409 — only preview is 409).
   */
  @Get(':assetId')
  @Authorize(
    ACTIONS['media.manage'],
    cmsResource('forAsset', 'assetId'),
    { denyAs: 'not_found' },
  )
  async detail(
    @Param('assetId') assetId: string,
  ) {
    const detail = await this.mediaService.getDetail(assetId);
    if (!detail) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }
    return detail;
  }

  @Put(':assetId')
  @Authorize(ACTIONS['media.manage'], operationsResource('media_asset', assetIdFromParam))
  async update(
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(MediaAssetUpdateSchema)) body: MediaAssetUpdate,
    @CurrentPrincipal() principal: Principal,
  ) {
    const resource = await this.cmsResourceLoader.forAsset(assetId);
    if (!resource) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }

    // Scope check
    const allowed = await this.cmsScopeService.allowedCategoryIds(
      principal,
      ACTIONS['media.manage'],
    );
    if (resource.collectionId && !allowed.includes(resource.collectionId)) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }

    const result = await this.mediaService.updateAsset(assetId, body, principal);
    if (!result) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }
    return result;
  }

  @Delete(':assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorize(ACTIONS['media.manage'], operationsResource('media_asset', assetIdFromParam))
  async deleteAsset(
    @Param('assetId') assetId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    const resource = await this.cmsResourceLoader.forAsset(assetId);
    if (!resource) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }

    // Scope check
    const allowed = await this.cmsScopeService.allowedCategoryIds(
      principal,
      ACTIONS['media.manage'],
    );
    if (resource.collectionId && !allowed.includes(resource.collectionId)) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }

    await this.mediaService.deleteAsset(assetId, principal);
  }

  /**
   * Preview a rendition (I4): missing → 404, out-of-scope → 404 (not 403),
   * in-scope + unready → 409 media_not_ready.
   *
   * Authorization uses cmsResource('forAsset') + denyAs:'not_found' so the
   * guard handles scope; the handler only checks readiness and streams.
   */
  @Get(':assetId/:rendition')
  @Authorize(
    ACTIONS['content.preview'],
    cmsResource('forAsset', 'assetId'),
    { denyAs: 'not_found' },
  )
  async preview(
    @Param('assetId') assetId: string,
    @Param('rendition') renditionKind: string,
    @Req() req: HttpReq,
    @Res() res: HttpRes,
  ) {
    // I7: Validate rendition kind against the enum
    const renditionParsed = MediaRenditionKindSchema.safeParse(renditionKind);
    if (!renditionParsed.success) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Invalid rendition kind',
      });
    }

    // Only ready assets can be previewed by staff
    const asset = await this.mediaService.getAsset(assetId);
    if (!asset) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }
    if (asset.state !== 'ready') {
      throw new ApiHttpException({
        status: 409,
        code: 'media_not_ready',
        message: 'This media asset is not yet ready for preview',
      });
    }

    const rendition = await this.mediaService.getRendition(assetId, renditionKind);
    if (!rendition) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Rendition not found',
      });
    }

    // Stream using the shared delivery helper (C3)
    await deliverRendition(
      this.storage,
      {
        storageKey: rendition.storageKey,
        mimeType: rendition.mimeType,
        byteSize: rendition.byteSize,
        kind: rendition.kind,
      },
      req as DeliverReq,
      res as DeliverRes,
    );
  }
}

/** Route-parameter id extractor for `operationsResource` on update/delete routes. */
function assetIdFromParam(req: Record<string, unknown>): string | undefined {
  const params = req['params'] as Record<string, string | undefined> | undefined;
  return params?.['assetId'];
}
