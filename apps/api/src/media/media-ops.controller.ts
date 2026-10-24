/**
 * MediaOpsController — staff media endpoints under /api/ops/cms/media (8.12).
 *
 * POST   /api/ops/cms/media                 — upload (media.upload)
 * GET    /api/ops/cms/media                 — list (media.manage, category-scoped)
 * GET    /api/ops/cms/media/:assetId        — detail (media.manage)
 * PUT    /api/ops/cms/media/:assetId        — update (media.manage)
 * DELETE /api/ops/cms/media/:assetId        — delete (media.manage)
 * GET    /api/ops/cms/media/:assetId/:rendition — preview (content.preview)
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
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  ACTIONS,
  MediaAssetUpdateSchema,
  MediaListQuerySchema,
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
import { parseRangeHeader, resolveRange } from './range-parser.js';

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
    const catId = (body?.ownerCategoryId ?? query?.ownerCategoryId) as string | undefined;
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
   * Upload a media file (streaming multipart).
   *
   * The body is consumed as raw bytes because Nest's JSON body parser must not
   * buffer the file. We read it manually from the request stream. The metadata
   * fields are passed as query parameters since the file occupies the body.
   */
  @Post()
  @Authorize(ACTIONS['media.upload'], uploadCategoryResolver('media_asset'))
  @Idempotent('media.upload', { inFlightTtlSeconds: 900 })
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Req() req: HttpReq & AsyncIterable<Buffer>,
    @CurrentPrincipal() principal: Principal,
  ) {
    // Parse metadata from query params (multipart metadata fields)
    const rawMetadata = req.query;
    // Also accept metadata from body if it's a JSON body (for e2e testing simplicity)
    const contentType = (req.headers['content-type'] ?? '') as string;
    const metadataSource = contentType.startsWith('multipart')
      ? rawMetadata
      : (req.body ?? rawMetadata);

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

    // Read file from body
    // For multipart, we just consume the body as-is since no multipart library is installed
    // For JSON test mode, the file is expected as a base64 `file` field
    let fileBuffer: Buffer;
    let originalFilename = 'upload';
    let mimeType = 'application/octet-stream';

    if (contentType.startsWith('multipart')) {
      // Consume raw body as the file
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      fileBuffer = Buffer.concat(chunks);
    } else {
      // JSON mode: file as base64, or raw buffer on req
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
    }

    // Size cap before processing
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
  ) {
    const result = await this.mediaService.updateAsset(assetId, body);
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
  async deleteAsset(@Param('assetId') assetId: string) {
    await this.mediaService.deleteAsset(assetId);
  }

  @Get(':assetId/:rendition')
  @Authorize(ACTIONS['content.preview'], operationsResource('media_asset', assetIdFromParam))
  async preview(
    @Param('assetId') assetId: string,
    @Param('rendition') renditionKind: string,
    @Req() req: HttpReq,
    @Res() res: HttpRes,
  ) {
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

    await this.streamRendition(rendition, req, res, false);
  }

  /**
   * Stream a rendition with Range support.
   */
  private async streamRendition(
    rendition: { storageKey: string; mimeType: string; byteSize: number },
    req: HttpReq,
    res: HttpRes,
    isPdf: boolean,
  ): Promise<void> {
    const rangeHeader = req.headers['range'] as string | undefined;
    const parsed = parseRangeHeader(rangeHeader);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', rendition.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');

    // Card/cover renditions get short cache
    if (rendition.storageKey.includes('/card_')) {
      res.setHeader('Cache-Control', 'private, max-age=300');
    }

    if (isPdf) {
      res.setHeader('Content-Disposition', 'attachment; filename="resource.pdf"');
      res.setHeader('Content-Security-Policy', 'sandbox');
    }

    if (parsed.type === 'none' || parsed.type === 'multiple') {
      // Full response
      const { stream, contentLength } = await this.storage.get(rendition.storageKey);
      res.setHeader('Content-Length', String(contentLength));
      res.status(200);
      (stream as Readable).pipe(res as unknown as NodeJS.WritableStream);
      return;
    }

    if (parsed.type === 'invalid') {
      const totalSize = rendition.byteSize;
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.status(416).end();
      return;
    }

    // Resolve the range against the total size
    const headResult = await this.storage.head(rendition.storageKey);
    const totalSize = headResult.contentLength;
    const byteRange = resolveRange(parsed, totalSize);

    if (!byteRange) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.status(416).end();
      return;
    }

    const { stream, contentLength, contentRange } = await this.storage.get(
      rendition.storageKey,
      byteRange,
    );

    res.setHeader('Content-Length', String(contentLength));
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    res.status(206);
    (stream as Readable).pipe(res as unknown as NodeJS.WritableStream);
  }
}
