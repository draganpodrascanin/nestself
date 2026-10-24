/**
 * MediaLibraryController — employee media delivery with Range support (8.8).
 *
 * GET /api/library/media/:assetId/:rendition
 *
 * Every request (including Range) re-runs authorization and availability
 * (MED-R-18, MED-R-20). Failures return 404 content_not_available
 * (non-disclosure, ACC-R-23).
 *
 * Delivery uses the shared deliverRendition() helper (C3: pipeline-based,
 * safe teardown on abort/read errors).
 *
 * Locale: the reader's Accept-Language header is restricted to the four
 * supported locales (sr-Latn, sr-Cyrl, hu, en); default sr-Latn (I5).
 */
import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { ACTIONS, MediaRenditionKindSchema, type Principal } from '@nestself/contracts';
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
import { deliverRendition, type DeliverReq, type DeliverRes } from './deliver-rendition.js';
import type { ReaderLocale } from '../library/availability/availability-context.js';

const NOT_AVAILABLE = new ApiHttpException({
  status: 404,
  code: 'content_not_available',
  message: 'The requested content is not available',
});

/** Supported reader locales (I5). */
const SUPPORTED_LOCALES: readonly ReaderLocale[] = ['sr-Latn', 'sr-Cyrl', 'hu', 'en'];
const DEFAULT_LOCALE: ReaderLocale = 'sr-Latn';

/** Route-parameter id extractor for `personalOrgResource`. */
const assetIdParam = (req: Record<string, unknown>): string | undefined => {
  const params = req['params'] as Record<string, string | undefined> | undefined;
  return params?.['assetId'];
};

/**
 * Minimal request shape we need from the Express/platform-express request.
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
  on(event: string, listener: (...args: unknown[]) => void): void;
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
    // I7: Validate rendition kind against the enum early
    const renditionParsed = MediaRenditionKindSchema.safeParse(renditionKind);
    if (!renditionParsed.success) {
      throw NOT_AVAILABLE;
    }

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

    // I5: Parse Accept-Language to determine the reader's locale
    const readerLocale = parseAcceptLocale(req.headers['accept-language']);

    // Build reader context
    const readerCtx = await this.availabilityContextLoader.forReader(
      {
        userId: principal.userId,
        orgId: ctx.orgId,
        membershipId: membership.membershipId,
      },
      readerLocale,
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

/**
 * Parse Accept-Language header to determine the reader's locale (I5).
 * Restricts to the four supported locales; defaults to sr-Latn.
 */
function parseAcceptLocale(
  header: string | string[] | undefined,
): ReaderLocale {
  if (!header) return DEFAULT_LOCALE;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return DEFAULT_LOCALE;

  // Parse "en, sr-Latn;q=0.9, hu;q=0.8" into weighted entries
  const entries = raw.split(',').map((part) => {
    const [lang, ...params] = part.trim().split(';');
    const qParam = params.find((p) => p.trim().startsWith('q='));
    const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
    return { lang: lang!.trim().toLowerCase(), q: isNaN(q) ? 0 : q };
  });

  entries.sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    // Exact match
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === entry.lang);
    if (exact) return exact;
    // Prefix match (e.g., "sr" → "sr-Latn")
    const prefix = SUPPORTED_LOCALES.find(
      (l) => l.toLowerCase().startsWith(entry.lang + '-') ||
             entry.lang.startsWith(l.toLowerCase() + '-'),
    );
    if (prefix) return prefix;
    // "sr" without subtag → sr-Latn
    if (entry.lang === 'sr') return 'sr-Latn';
  }

  return DEFAULT_LOCALE;
}
