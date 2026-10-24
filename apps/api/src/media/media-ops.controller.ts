/**
 * MediaOpsController — staff media endpoints under /api/ops/cms/media (8.12).
 *
 * POST   /api/ops/cms/media                 — upload (media.upload)
 * GET    /api/ops/cms/media                 — list (media.manage, category-scoped)
 * GET    /api/ops/cms/media/:assetId        — detail (media.manage)
 * PUT    /api/ops/cms/media/:assetId        — update (media.manage)
 * DELETE /api/ops/cms/media/:assetId        — delete (media.manage)
 * GET    /api/ops/cms/media/:assetId/:rendition — preview (content.preview)
 *
 * C2: Upload uses FileInterceptor (multer) for real multipart streaming.
 *     JSON-body mode is kept for e2e test convenience.
 * C3: Delivery uses deliverRendition() for pipeline-based streaming.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ACTIONS,
  MediaAssetUpdateSchema,
  MediaListQuerySchema,
  MediaRenditionKindSchema,
  type MediaAssetUpdate,
  type MediaListQuery,
  type Principal,
  type Resource,
} from '@nestself/contracts';
import { MEDIA_KIND_MAX_BYTES, MEDIA_KINDS_ENABLED, MediaUploadMetadataSchema } from '@nestself/contracts';
import { Authorize, type ResourceResolver } from '../authz/authorize.decorator.js';
import { operationsResource, assertOperationsSession } from '../authz/resolvers.js';
import { operationsCategoryScope } from '../authz/operations-category-scope.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MediaService } from './media.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CmsScopeService } from '../authz/cms-scope.service.js';
import { Inject } from '@nestjs/common';
import { MEDIA_STORAGE, type MediaStorage } from './storage/media-storage.js';
import { deliverRendition, type DeliverReq, type DeliverRes } from './deliver-rendition.js';

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

/** Route-parameter id extractor for `operationsResource`. */
const assetIdFromParam = (req: Record<string, unknown>): string | undefined => {
  const params = req['params'] as Record<string, string | undefined> | undefined;
  return params?.['assetId'];
};

/**
 * Upload resolver: extract `ownerCategoryId` from the parsed JSON body
 * or from the query string (multipart). The guard runs after Express's
 * body parser so the body is available for JSON requests.
 */
function uploadCategoryResolver(type: string): ResourceResolver {
  return (req, principal: Principal): Resource => {
    assertOperationsSession(principal);
    const body = (req as { body?: Record<string, unknown> }).body;
    const query = (req as { query?: Record<string, unknown> }).query;
    // Take the first value if query param is an array (reject duplicate params)
    let catId = (body?.ownerCategoryId ?? query?.ownerCategoryId) as string | string[] | undefined;
    if (Array.isArray(catId)) catId = catId[0];
    if (catId) return { type, collectionId: catId };
    // Without a category, return type-only so the guard can check the action exists
    return { type };
  };
}


@Controller('ops/cms/media')
export class MediaOpsController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly cmsScopeService: CmsScopeService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  /**
   * Upload a media file.
   *
   * Supports two modes:
   * 1. Multipart form-data (Content-Type: multipart/form-data):
   *    File field "file", metadata in query params.
   * 2. JSON body (for e2e tests): file as base64 string in "file" field,
   *    metadata inline.
   */
  @Post()
  @Authorize(ACTIONS['media.upload'], uploadCategoryResolver('media_asset'))
  @Idempotent('media.upload', { inFlightTtlSeconds: 900 })
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      // Hard cap — the kind-specific limit is checked after.
      fileSize: 300 * 1024 * 1024, // 300 MB (largest kind: video)
    },
  }))
  async upload(
    @Req() req: HttpReq & AsyncIterable<Buffer>,
    @UploadedFile() uploadedFile: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    // Parse metadata from query params (multipart) or body (JSON)
    const contentType = (req.headers['content-type'] ?? '') as string;
    const metadataSource = contentType.startsWith('multipart')
      ? req.query
      : (req.body ?? req.query);

    const metadata = MediaUploadMetadataSchema.parse(metadataSource);

    // Check kind is enabled
    if (!MEDIA_KINDS_ENABLED.includes(metadata.kind)) {
      throw new ApiHttpException({
        status: 400,
        code: 'media_type_rejected',
        message: `Media kind '${metadata.kind}' is not enabled`,
        details: { reason: 'kind_not_enabled' },
      });
    }

    // Get file buffer
    let fileBuffer: Buffer;
    let originalFilename = 'upload';
    let mimeType = 'application/octet-stream';

    if (uploadedFile) {
      // Multipart upload via FileInterceptor/multer (C2)
      fileBuffer = uploadedFile.buffer;
      originalFilename = uploadedFile.originalname || 'upload';
      mimeType = uploadedFile.mimetype || 'application/octet-stream';
    } else if (!contentType.startsWith('multipart')) {
      // JSON mode: file as base64
      const body = req.body;
      if (body?.file && typeof body.file === 'string') {
        fileBuffer = Buffer.from(body.file, 'base64');
      } else if (body?.fileBuffer && Buffer.isBuffer(body.fileBuffer)) {
        fileBuffer = body.fileBuffer as Buffer;
      } else {
        throw new ApiHttpException({
          status: 400,
          code: 'validation',
          message: 'No file provided',
        });
      }
      if (typeof body?.originalFilename === 'string') {
        originalFilename = body.originalFilename;
      }
      if (typeof body?.mimeType === 'string') {
        mimeType = body.mimeType;
      }
    } else {
      // Multipart but multer didn't find a file
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: 'No file provided in multipart request (expected field name "file")',
      });
    }

    // Size cap before processing (413)
    const maxBytes = MEDIA_KIND_MAX_BYTES[metadata.kind];
    if (fileBuffer.length > maxBytes) {
      throw new ApiHttpException({
        status: 413,
        code: 'media_too_large',
        message: `File exceeds maximum size of ${maxBytes} bytes for kind '${metadata.kind}'`,
        details: { maxBytes, actualBytes: fileBuffer.length },
      });
    }

    const result = await this.mediaService.upload(
      fileBuffer,
      mimeType,
      originalFilename,
      metadata,
      principal,
    );

    return result;
  }

  @Get()
  @Authorize(ACTIONS['media.manage'], operationsCategoryScope('media_asset', { list: true }))
  async list(
    @Query(new ZodValidationPipe(MediaListQuerySchema)) query: MediaListQuery,
    @CurrentPrincipal() principal: Principal,
  ) {
    // Determine category ids the principal can access
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

  @Get(':assetId')
  @Authorize(ACTIONS['media.manage'], operationsResource('media_asset', assetIdFromParam))
  async detail(@Param('assetId') assetId: string) {
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
    await this.mediaService.deleteAsset(assetId, principal);
  }

  @Get(':assetId/:rendition')
  @Authorize(ACTIONS['content.preview'], operationsResource('media_asset', assetIdFromParam))
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
    if (!asset || asset.state !== 'ready') {
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
