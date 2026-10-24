/**
 * MediaLibraryController — employee media delivery with Range support (8.8).
 *
 * GET /api/library/media/:assetId/:rendition
 *
 * Every request (including Range) re-runs authorization and availability
 * (MED-R-18, MED-R-20). Failures return 404 content_not_available
 * (non-disclosure, ACC-R-23).
 */
import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { ACTIONS, type Principal } from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { personalOrgResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaService } from './media.service.js';
import { MEDIA_STORAGE, type MediaStorage } from './storage/media-storage.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AvailabilityService } from '../library/availability/availability.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AvailabilityContextLoader } from '../library/availability/availability-context-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import { parseRangeHeader, resolveRange } from './range-parser.js';

const NOT_AVAILABLE = new ApiHttpException({
  status: 404,
  code: 'content_not_available',
  message: 'The requested content is not available',
});

/** Route-parameter id extractor for `personalOrgResource`. */
const assetIdParam = (req: Record<string, unknown>): string | undefined => {
  const params = req['params'] as Record<string, string | undefined> | undefined;
  return params?.['assetId'];
};

/**
 * Minimal request shape we need from the Express/platform-express request
 * (avoids importing `@types/express` which is not installed).
 */
interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Minimal response shape (Express-compatible).
 */
interface HttpRes {
  setHeader(name: string, value: string | number): void;
  status(code: number): HttpRes;
  end(): void;
}

@Controller('library/media')
export class MediaLibraryController {
  constructor(
    private readonly mediaService: MediaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    private readonly availabilityService: AvailabilityService,
    private readonly availabilityContextLoader: AvailabilityContextLoader,
    private readonly dbService: DbService,
  ) {}

  @Get(':assetId/:rendition')
  @Authorize(ACTIONS['content.read'], personalOrgResource('media_asset', assetIdParam))
  async deliver(
    @Param('assetId') assetId: string,
    @Param('rendition') renditionKind: string,
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
    @Res() res: HttpRes,
  ) {
    // Check asset exists and is ready with valid rights
    const asset = await this.mediaService.getAsset(assetId);
    if (!asset) throw NOT_AVAILABLE;
    if (asset.state !== 'ready') throw NOT_AVAILABLE;

    // Check rights expiry
    if (asset.rightsExpiresAt && asset.rightsExpiresAt <= new Date()) {
      throw NOT_AVAILABLE;
    }

    // Check scan status (production guard)
    if (
      process.env.NODE_ENV === 'production' &&
      asset.scanStatus !== 'no_threats_found'
    ) {
      throw NOT_AVAILABLE;
    }

    // Check availability through the publication chain
    const ctx = principal.context;
    if (ctx.kind !== 'personal' || !ctx.orgId) {
      throw NOT_AVAILABLE;
    }

    // Resolve the membership for this org from the principal's memberships list
    const membership = principal.memberships.find((m) => m.orgId === ctx.orgId);
    if (!membership) throw NOT_AVAILABLE;

    // Build reader context
    const readerCtx = await this.availabilityContextLoader.forReader(
      {
        userId: principal.userId,
        orgId: ctx.orgId,
        membershipId: membership.membershipId,
      },
      'sr-Latn', // Default locale for media availability check
    );

    const available = await this.availabilityService.isMediaAssetAvailable(
      readerCtx,
      this.dbService.db,
      assetId,
    );

    if (!available) throw NOT_AVAILABLE;

    // Get the rendition
    const rendition = await this.mediaService.getRendition(assetId, renditionKind);
    if (!rendition) throw NOT_AVAILABLE;

    // Stream with Range support
    const isPdf = rendition.mimeType === 'application/pdf';

    const rangeHeader = req.headers['range'] as string | undefined;
    const parsed = parseRangeHeader(rangeHeader);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', rendition.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');

    // Card images get short cache (MED-R-21)
    if (rendition.kind === 'card_webp' || rendition.kind === 'card_jpeg') {
      res.setHeader('Cache-Control', 'private, max-age=300');
    }

    if (isPdf) {
      res.setHeader('Content-Disposition', 'attachment; filename="resource.pdf"');
      res.setHeader('Content-Security-Policy', 'sandbox');
    }

    if (parsed.type === 'none' || parsed.type === 'multiple') {
      const { stream, contentLength } = await this.storage.get(rendition.storageKey);
      res.setHeader('Content-Length', String(contentLength));
      res.status(200);
      (stream as Readable).pipe(res as unknown as NodeJS.WritableStream);
      return;
    }

    if (parsed.type === 'invalid') {
      res.setHeader('Content-Range', `bytes */${rendition.byteSize}`);
      res.status(416).end();
      return;
    }

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
