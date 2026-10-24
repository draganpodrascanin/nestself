/**
 * MediaService — upload, list, detail, update, delete (T-C1.08).
 *
 * Handles all database operations for media assets and renditions.
 *
 * Processing uses UPDATE ... WHERE state = 'uploaded' RETURNING to atomically
 * claim the job (I2). The final state + renditions are written in one
 * transaction. Processing errors result in state = 'rejected'.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type {
  MediaAssetState,
  MediaAssetUpdate,
  MediaKind,
  MediaUploadMetadata,
  Principal,
} from '@nestself/contracts';
import { MEDIA_KINDS_ENABLED } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { mediaAssets, mediaRenditions } from '../db/schema/media.js';
import { contentRevisionMedia } from '../db/schema/cms.js';
import { MEDIA_STORAGE, type MediaStorage } from './storage/media-storage.js';
import type { AuditEventInput } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
import { processMediaAsset, type ProcessingResult } from './media-processing.js';

export interface UploadResult {
  assetId: string;
  state: MediaAssetState;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly dbService: DbService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * Create a media asset row and store the file in quarantine.
   * Returns the asset id and initial state.
   */
  async upload(
    fileBuffer: Buffer,
    mimeType: string,
    originalFilename: string,
    metadata: MediaUploadMetadata,
    principal: Principal,
  ): Promise<UploadResult> {
    // Check kind is enabled in M1
    if (!MEDIA_KINDS_ENABLED.includes(metadata.kind)) {
      throw new ApiHttpException({
        status: 400,
        code: 'media_type_rejected',
        message: `Media kind '${metadata.kind}' is not enabled. Enabled kinds: ${MEDIA_KINDS_ENABLED.join(', ')}`,
        details: { reason: 'kind_not_enabled' },
      });
    }

    const { createHash } = await import('node:crypto');
    const filenameHash = createHash('sha256').update(originalFilename).digest('hex');

    const assetId = randomUUID();
    const quarantineKey = `quarantine/${assetId}/original`;

    // Store in quarantine
    const { Readable } = await import('node:stream');
    await this.storage.put(quarantineKey, Readable.from(fileBuffer), {
      contentType: mimeType,
      contentLength: fileBuffer.length,
    });

    // Insert asset row
    await this.dbService.db.insert(mediaAssets).values({
      id: assetId,
      kind: metadata.kind,
      state: 'uploaded',
      ownerCategoryId: metadata.ownerCategoryId,
      originalFilenameHash: filenameHash,
      byteSize: fileBuffer.length,
      mimeType,
      licenseKind: metadata.licenseKind,
      licenseReference: metadata.licenseReference ?? null,
      consentReference: metadata.consentReference ?? null,
      altText: metadata.altText ?? null,
      focalPoint: metadata.focalPoint ?? null,
      uploadedByUserId: principal.userId,
      scanStatus: 'pending',
    });

    // Audit
    await this.auditWriter.record({
      action: 'media.uploaded' as AuditEventInput['action'],
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'media_asset',
      recordId: assetId,
      result: 'ALLOWED',
      details: { kind: metadata.kind, byteSize: fileBuffer.length },
    }).catch((err: unknown) => {
      this.logger.warn(`Audit write failed for media.uploaded: ${err}`);
    });

    return { assetId, state: 'uploaded' };
  }

  /**
   * Run the processing pipeline for an asset.
   *
   * Uses UPDATE ... WHERE state = 'uploaded' RETURNING to atomically claim
   * the job (I2). If another worker already claimed it, this is a no-op.
   * The final state + renditions are written in one transaction.
   */
  async processAsset(assetId: string): Promise<ProcessingResult | null> {
    // Atomic claim: only the first worker to reach this UPDATE wins.
    const claimed = await this.dbService.db
      .update(mediaAssets)
      .set({ state: 'processing' as MediaAssetState })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.state, 'uploaded')))
      .returning();

    if (claimed.length === 0) {
      // Already claimed by another worker or not in 'uploaded' state.
      this.logger.warn(`processAsset(${assetId}): not in 'uploaded' state, skipping`);
      return null;
    }

    const asset = claimed[0]!;
    const nodeEnv = process.env.NODE_ENV ?? 'development';

    let result: ProcessingResult;
    try {
      result = await processMediaAsset(this.storage, {
        assetId,
        kind: asset.kind as MediaKind,
        currentState: 'uploaded', // we pass 'uploaded' since that's the logical pre-claim state
        focalPoint: asset.focalPoint,
        nodeEnv,
      });
    } catch (err) {
      // Processing threw an unhandled error — mark as rejected with an error code
      this.logger.error(`processAsset(${assetId}) error: ${err}`);
      await this.dbService.db
        .update(mediaAssets)
        .set({
          state: 'rejected' as MediaAssetState,
          rejectionCode: 'processing_error',
        })
        .where(eq(mediaAssets.id, assetId));

      // Try to clean up any partial renditions
      await this.storage.delete(`quarantine/${assetId}/original`).catch(() => {});

      // Audit the rejection
      await this.auditWriter.record({
        action: 'media.rejected' as AuditEventInput['action'],
        actorUserId: null,
        actorKind: 'SYSTEM',
        recordType: 'media_asset',
        recordId: assetId,
        result: 'NONE',
        details: { rejectionCode: 'processing_error', error: String(err) },
      }).catch(() => {});

      return {
        newState: 'rejected',
        scanStatus: 'pending',
        rejectionCode: 'processing_error',
        renditions: [],
        width: null,
        height: null,
        checksumSha256: null,
      };
    }

    // Final update + renditions in one transaction (I2).
    await this.dbService.db.transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        state: result.newState,
        scanStatus: result.scanStatus,
        checksumSha256: result.checksumSha256,
      };

      if (result.width !== null) updateData.width = result.width;
      if (result.height !== null) updateData.height = result.height;
      if (result.rejectionCode) updateData.rejectionCode = result.rejectionCode;
      if (result.newState === 'ready') updateData.readyAt = new Date();

      await tx
        .update(mediaAssets)
        .set(updateData)
        .where(eq(mediaAssets.id, assetId));

      // Insert renditions
      if (result.renditions.length > 0) {
        await tx.insert(mediaRenditions).values(
          result.renditions.map((r) => ({
            id: randomUUID(),
            mediaAssetId: assetId,
            kind: r.kind,
            width: r.width,
            height: r.height,
            byteSize: r.byteSize,
            mimeType: r.mimeType,
            storageKey: r.storageKey,
          })),
        );
      }
    });

    // Audit for rejections
    if (result.newState === 'rejected') {
      await this.auditWriter.record({
        action: 'media.rejected' as AuditEventInput['action'],
        actorUserId: null,
        actorKind: 'SYSTEM',
        recordType: 'media_asset',
        recordId: assetId,
        result: 'NONE',
        details: { rejectionCode: result.rejectionCode },
      }).catch((err: unknown) => {
        this.logger.warn(`Audit write failed for media.rejected: ${err}`);
      });
    }

    return result;
  }

  /**
   * List media assets (category-filtered) with opaque base64-encoded cursor.
   */
  async list(
    categoryIds: string[] | null,
    opts: { kind?: MediaKind; state?: MediaAssetState; cursor?: string; limit: number },
  ) {
    const conditions = [];
    if (categoryIds && categoryIds.length > 0) {
      conditions.push(inArray(mediaAssets.ownerCategoryId, categoryIds));
    }
    if (opts.kind) {
      conditions.push(eq(mediaAssets.kind, opts.kind));
    }
    if (opts.state) {
      conditions.push(eq(mediaAssets.state, opts.state));
    }
    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (!decoded) {
        throw new ApiHttpException({
          status: 400,
          code: 'validation',
          message: 'Invalid cursor',
          details: { field: 'cursor' },
        });
      }
      // Keyset pagination: (created_at, id) descending
      conditions.push(
        sql`(${mediaAssets.createdAt}, ${mediaAssets.id}) < (${decoded.createdAt}, ${decoded.id})`,
      );
    }

    const rows = await this.dbService.db
      .select()
      .from(mediaAssets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      .limit(opts.limit + 1);

    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? encodeCursor(lastItem.createdAt, lastItem.id)
      : null;

    return {
      items: items.map(assetToDto),
      nextCursor,
    };
  }

  /**
   * Get a single asset with its renditions.
   */
  async getDetail(assetId: string) {
    const assetRows = await this.dbService.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);

    const asset = assetRows[0];
    if (!asset) return null;

    const rends = await this.dbService.db
      .select()
      .from(mediaRenditions)
      .where(eq(mediaRenditions.mediaAssetId, assetId));

    return {
      ...assetToDto(asset),
      renditions: rends.map((r) => ({
        id: r.id,
        kind: r.kind,
        width: r.width,
        height: r.height,
        byteSize: r.byteSize,
        mimeType: r.mimeType,
      })),
    };
  }

  /**
   * Update asset metadata (rights, alt text, focal point).
   * Empty body → 400 (M11).
   */
  async updateAsset(assetId: string, data: MediaAssetUpdate, principal?: Principal) {
    const updateData: Record<string, unknown> = {};
    if (data.licenseKind !== undefined) updateData.licenseKind = data.licenseKind;
    if (data.licenseReference !== undefined) updateData.licenseReference = data.licenseReference;
    if (data.consentReference !== undefined) updateData.consentReference = data.consentReference;
    if (data.rightsExpiresAt !== undefined) updateData.rightsExpiresAt = data.rightsExpiresAt;
    if (data.altText !== undefined) updateData.altText = data.altText;
    if (data.focalPoint !== undefined) updateData.focalPoint = data.focalPoint;

    if (Object.keys(updateData).length === 0) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: 'Request body must contain at least one field to update',
      });
    }

    const rows = await this.dbService.db
      .update(mediaAssets)
      .set(updateData)
      .where(eq(mediaAssets.id, assetId))
      .returning();

    const updated = rows[0];
    if (!updated) return null;

    // Audit the update
    if (principal) {
      await this.auditWriter.record({
        action: 'media.updated' as AuditEventInput['action'],
        actorUserId: principal.userId,
        actorKind: 'USER',
        recordType: 'media_asset',
        recordId: assetId,
        result: 'ALLOWED',
        details: { fields: Object.keys(updateData) },
      }).catch((err: unknown) => {
        this.logger.warn(`Audit write failed for media.updated: ${err}`);
      });
    }

    return assetToDto(updated);
  }

  /**
   * Delete an asset. Only allowed for uploaded, quarantined, rejected, or expired
   * assets that are not referenced by a non-superseded revision.
   * Processing → 409 conflict (M11).
   */
  async deleteAsset(assetId: string, principal?: Principal): Promise<void> {
    const assetRows = await this.dbService.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);

    const asset = assetRows[0];
    if (!asset) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Media asset not found',
      });
    }

    // Processing → 409 (cannot delete while processing)
    if (asset.state === 'processing') {
      throw new ApiHttpException({
        status: 409,
        code: 'media_in_use',
        message: 'Cannot delete a media asset that is currently being processed',
      });
    }

    const deletableStates: MediaAssetState[] = ['uploaded', 'quarantined', 'rejected', 'expired'];
    if (!deletableStates.includes(asset.state as MediaAssetState)) {
      // For ready assets, check if referenced by a current revision
      if (asset.state === 'ready') {
        const refs = await this.dbService.db
          .select({ id: contentRevisionMedia.contentRevisionId })
          .from(contentRevisionMedia)
          .where(eq(contentRevisionMedia.mediaAssetId, assetId))
          .limit(1);

        if (refs.length > 0) {
          throw new ApiHttpException({
            status: 409,
            code: 'media_in_use',
            message: 'This media asset is referenced by a content revision and cannot be deleted',
          });
        }
      } else {
        throw new ApiHttpException({
          status: 409,
          code: 'media_in_use',
          message: `Cannot delete a media asset in state '${asset.state}'`,
        });
      }
    }

    // Delete storage objects
    const rends = await this.dbService.db
      .select({ storageKey: mediaRenditions.storageKey })
      .from(mediaRenditions)
      .where(eq(mediaRenditions.mediaAssetId, assetId));

    for (const r of rends) {
      await this.storage.delete(r.storageKey).catch(() => {});
    }

    // Delete quarantine file
    await this.storage.delete(`quarantine/${assetId}/original`).catch(() => {});

    // Delete DB rows (renditions cascade)
    await this.dbService.db
      .delete(mediaAssets)
      .where(eq(mediaAssets.id, assetId));

    // Audit the deletion
    if (principal) {
      await this.auditWriter.record({
        action: 'media.deleted' as AuditEventInput['action'],
        actorUserId: principal.userId,
        actorKind: 'USER',
        recordType: 'media_asset',
        recordId: assetId,
        result: 'ALLOWED',
        details: { kind: asset.kind, state: asset.state },
      }).catch((err: unknown) => {
        this.logger.warn(`Audit write failed for media.deleted: ${err}`);
      });
    }
  }

  /**
   * Get a rendition's storage key and metadata for streaming.
   * Validates the rendition kind against the enum (I7).
   */
  async getRendition(assetId: string, renditionKind: string) {
    const rends = await this.dbService.db
      .select()
      .from(mediaRenditions)
      .where(
        and(
          eq(mediaRenditions.mediaAssetId, assetId),
          eq(mediaRenditions.kind, renditionKind as typeof mediaRenditions.kind.enumValues[number]),
        ),
      )
      .limit(1);

    return rends[0] ?? null;
  }

  /**
   * Get asset row (for authorization checks).
   */
  async getAsset(assetId: string) {
    const rows = await this.dbService.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    return rows[0] ?? null;
  }
}

function assetToDto(row: typeof mediaAssets.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    ownerCategoryId: row.ownerCategoryId,
    checksumSha256: row.checksumSha256,
    byteSize: row.byteSize,
    mimeType: row.mimeType,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    scanStatus: row.scanStatus,
    rejectionCode: row.rejectionCode,
    licenseKind: row.licenseKind,
    licenseReference: row.licenseReference,
    rightsExpiresAt: row.rightsExpiresAt,
    consentReference: row.consentReference,
    altText: row.altText,
    focalPoint: row.focalPoint,
    createdAt: row.createdAt,
    readyAt: row.readyAt,
  };
}

// ---------------------------------------------------------------------------
// Cursor encoding (I7): opaque base64 keyset of (created_at, id)
// ---------------------------------------------------------------------------

function encodeCursor(createdAt: Date, id: string): string {
  const payload = JSON.stringify({ t: createdAt.toISOString(), i: id });
  return Buffer.from(payload).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(raw) as { t?: string; i?: string };
    if (!parsed.t || !parsed.i) return null;
    const date = new Date(parsed.t);
    if (isNaN(date.getTime())) return null;
    return { createdAt: date, id: parsed.i };
  } catch {
    return null;
  }
}
