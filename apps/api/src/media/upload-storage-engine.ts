/**
 * UploadStorageEngine — custom multer StorageEngine that streams uploads
 * directly into quarantine storage, validating metadata, counting bytes,
 * computing SHA-256, and sniffing magic bytes during the request (MED-R-33).
 *
 * Metadata fields (kind, ownerCategoryId, licence, alt text, focal point)
 * must arrive as multipart form fields BEFORE the file part.  If they are
 * missing when _handleFile is called, the request is rejected with 400.
 *
 * The engine:
 * 1. Validates metadata with MediaUploadMetadataSchema.
 * 2. Validates the Content-Digest header (RFC 9530) if present.
 * 3. Inserts the asset row (state = 'uploaded').
 * 4. Streams file to `quarantine/<id>/original` through a Transform that
 *    counts bytes (per-kind cap + MEDIA_MAX_UPLOAD_BYTES), computes SHA-256,
 *    and sniffs the first bytes with `file-type`.
 * 5. On limit, sniff failure, digest mismatch, or client abort: deletes the
 *    partial storage object and the DB row.
 *
 * @see MED-R-33, T-C1.08
 */
import { randomUUID, createHash } from 'node:crypto';
import { Transform, type TransformCallback, PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromBuffer } from 'file-type';
import { Logger } from '@nestjs/common';
import type { MediaUploadMetadata } from '@nestself/contracts';
import {
  MediaUploadMetadataSchema,
  MEDIA_KIND_MAX_BYTES,
  MEDIA_KIND_ALLOWED_MIMES,
  MEDIA_KINDS_ENABLED,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { MediaStorage } from './storage/media-storage.js';
import type { DbService } from '../db/db.service.js';
import { mediaAssets } from '../db/schema/media.js';
import type { AuditWriter, AuditEventInput } from '../audit/audit-writer.js';
import type { CmsScopeService } from '../authz/cms-scope.service.js';
import type { Principal, Action } from '@nestself/contracts';
import { eq } from 'drizzle-orm';

const logger = new Logger('UploadStorageEngine');

/** Result attached to req.file by multer after _handleFile succeeds. */
export interface UploadedAsset {
  /** Asset row id. */
  assetId: string;
  /** Asset state after insertion. */
  state: 'uploaded';
  /** SHA-256 hex digest computed over the streamed bytes. */
  checksumSha256: string;
  /** Actual byte size written. */
  byteSize: number;
  /** Detected MIME type from magic bytes. */
  detectedMime: string;
  /** Validated upload metadata. */
  metadata: MediaUploadMetadata;
}

/** Multer-compatible StorageEngine interface. */
export interface StorageEngine {
  _handleFile(
    req: MulterReq,
    file: MulterFile,
    cb: (error: Error | null, info?: Partial<UploadedAsset>) => void,
  ): void;
  _removeFile(
    req: MulterReq,
    file: MulterFile & Partial<UploadedAsset>,
    cb: (error: Error | null) => void,
  ): void;
}

interface MulterReq {
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  stream: NodeJS.ReadableStream;
}

/** Maximum hard cap from env or the largest per-kind cap (video = 300 MB). */
const GLOBAL_MAX_BYTES = 300 * 1024 * 1024;

/**
 * Parse `Content-Digest: sha-256=:<base64>:` per RFC 9530.
 * Returns the raw base64 value (without the colons) or null if the
 * header is absent.  Throws ApiHttpException on malformed values.
 */
export function parseContentDigest(
  header: string | string[] | undefined,
): string | null {
  if (header === undefined) return null;
  const value = typeof header === 'string' ? header : header[0];
  if (!value) return null;

  const match = value.match(/^sha-256=:([A-Za-z0-9+/=]+):$/);
  if (!match) {
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message:
        'Content-Digest header must be `sha-256=:<base64>:` per RFC 9530',
      details: { header: 'Content-Digest' },
    });
  }
  return match[1]!;
}

/**
 * Create the custom multer StorageEngine.
 */
export function createUploadStorageEngine(opts: {
  storage: MediaStorage;
  dbService: DbService;
  auditWriter: AuditWriter;
  cmsScopeService: CmsScopeService;
  maxUploadBytes?: number;
}): StorageEngine {
  const { storage, dbService, auditWriter, cmsScopeService } = opts;
  const globalMax = opts.maxUploadBytes ?? GLOBAL_MAX_BYTES;

  return {
    _handleFile(req, file, cb) {
      handleFile(req, file, { storage, dbService, auditWriter, cmsScopeService, globalMax })
        .then((info) => cb(null, info))
        .catch((err: unknown) => cb(err instanceof Error ? err : new Error(String(err))));
    },

    _removeFile(req, file, cb) {
      // Called by multer on abort/error — clean up partial storage + row.
      const assetId = file.assetId;
      if (!assetId) return cb(null);
      const key = `quarantine/${assetId}/original`;
      Promise.all([
        storage.delete(key).catch(() => {}),
        dbService.db.delete(mediaAssets).where(eq(mediaAssets.id, assetId)).catch(() => {}),
      ]).then(() => cb(null), () => cb(null));
    },
  };
}

async function handleFile(
  req: MulterReq,
  file: MulterFile,
  ctx: {
    storage: MediaStorage;
    dbService: DbService;
    auditWriter: AuditWriter;
    cmsScopeService: CmsScopeService;
    globalMax: number;
  },
): Promise<UploadedAsset> {
  // ── 1. Validate metadata fields (must arrive before the file part) ──
  const body = req.body ?? {};
  // Multipart fields for JSON-like nested objects arrive as strings;
  // parse known JSON fields.
  const rawMetadata: Record<string, unknown> = { ...body };
  if (typeof rawMetadata.altText === 'string') {
    try { rawMetadata.altText = JSON.parse(rawMetadata.altText as string); } catch { /* keep as-is, validation will fail */ }
  }
  if (typeof rawMetadata.focalPoint === 'string') {
    try { rawMetadata.focalPoint = JSON.parse(rawMetadata.focalPoint as string); } catch { /* keep as-is */ }
  }

  let metadata: MediaUploadMetadata;
  try {
    metadata = MediaUploadMetadataSchema.parse(rawMetadata);
  } catch {
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message: 'Upload metadata must be sent as multipart fields before the file part',
      details: { reason: 'metadata_missing_or_invalid' },
    });
  }

  // ── 2. Check kind enabled ──
  if (!MEDIA_KINDS_ENABLED.includes(metadata.kind)) {
    throw new ApiHttpException({
      status: 400,
      code: 'media_type_rejected',
      message: `Media kind '${metadata.kind}' is not enabled`,
      details: { reason: 'kind_not_enabled' },
    });
  }

  // ── 2b. Authorize the owner category (C2, MED-R-33) ──
  // The guard phase used @Authenticated because NestJS guards run before
  // interceptors (before multer).  Now that metadata is parsed, verify
  // the principal holds media.upload on the target category.
  const principal = req.principal;
  if (!principal?.userId) {
    throw new ApiHttpException({
      status: 401,
      code: 'unauthenticated',
      message: 'Authentication required',
    });
  }

  const allowed = await ctx.cmsScopeService.allowedCategoryIds(
    principal,
    'media.upload' as Action,
  );
  if (!allowed.includes(metadata.ownerCategoryId)) {
    throw new ApiHttpException({
      status: 403,
      code: 'forbidden',
      message: 'Access denied',
    });
  }

  // ── 3. Parse Content-Digest ──
  const expectedDigestB64 = parseContentDigest(req.headers['content-digest']);

  // ── 4. Prepare the asset row ──
  const assetId = randomUUID();
  const quarantineKey = `quarantine/${assetId}/original`;

  const filenameHash = createHash('sha256').update(file.originalname || 'upload').digest('hex');

  // ── 5. Insert asset row (will be deleted on failure) ──
  await ctx.dbService.db.insert(mediaAssets).values({
    id: assetId,
    kind: metadata.kind,
    state: 'uploaded',
    ownerCategoryId: metadata.ownerCategoryId,
    originalFilenameHash: filenameHash,
    byteSize: 0, // updated after streaming
    mimeType: file.mimetype || 'application/octet-stream',
    licenseKind: metadata.licenseKind,
    licenseReference: metadata.licenseReference ?? null,
    consentReference: metadata.consentReference ?? null,
    altText: metadata.altText ?? null,
    focalPoint: metadata.focalPoint ?? null,
    uploadedByUserId: principal.userId,
    scanStatus: 'pending',
  });

  // ── 6. Stream the file through counting + hashing + sniffing ──
  const kindMax = MEDIA_KIND_MAX_BYTES[metadata.kind];
  const effectiveMax = Math.min(kindMax, ctx.globalMax);
  const allowedMimes = MEDIA_KIND_ALLOWED_MIMES[metadata.kind];

  let byteCount = 0;
  let sniffed = false;
  let detectedMime: string | undefined;
  const sniffBuffer: Buffer[] = [];
  const SNIFF_BYTES = 4100; // file-type needs ~4100 bytes
  const sha256 = createHash('sha256');

  const counter = new Transform({
    transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
      byteCount += chunk.length;

      // Accumulate for sniffing
      if (!sniffed) {
        sniffBuffer.push(chunk);
        const totalSniffed = sniffBuffer.reduce((s, b) => s + b.length, 0);
        if (totalSniffed >= SNIFF_BYTES) {
          sniffed = true;
          // Don't block the stream; sniff happens after accumulation.
        }
      }

      sha256.update(chunk);

      // Per-kind size cap
      if (byteCount > effectiveMax) {
        callback(
          new ApiHttpException({
            status: 413,
            code: 'media_too_large',
            message: `File exceeds maximum size of ${effectiveMax} bytes for kind '${metadata.kind}'`,
            details: { maxBytes: effectiveMax, actualBytes: byteCount },
          }),
        );
        return;
      }

      callback(null, chunk);
    },
  });

  // Build the storage stream through the counter
  const passthrough = new PassThrough();
  const fileStream = file.stream as unknown as NodeJS.ReadableStream;

  // Pipe file → counter → passthrough (for storage.put)
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await ctx.storage.delete(quarantineKey).catch(() => {});
    await ctx.dbService.db.delete(mediaAssets).where(eq(mediaAssets.id, assetId)).catch(() => {});
  };

  try {
    // pipeline() connects file → counter → passthrough.
    // storage.put() reads from passthrough (it internally pipelines
    // passthrough → writeStream).  Both must run concurrently:
    // pipeline feeds the passthrough, storage drains it.
    const pipelinePromise = pipeline(
      fileStream as NodeJS.ReadableStream,
      counter,
      passthrough,
    );

    const putPromise = ctx.storage.put(quarantineKey, passthrough as unknown as Readable, {
      contentType: file.mimetype || 'application/octet-stream',
      contentLength: 0, // unknown upfront for streaming
    });

    // Wait for both; if either fails (413 from counter, I/O error from
    // storage) Promise.all rejects with the first error.  Suppress the
    // secondary rejection from the partner promise to avoid unhandled
    // rejection warnings.
    await Promise.all([pipelinePromise, putPromise]).catch(async (err: unknown) => {
      await putPromise.catch(() => {});
      await pipelinePromise.catch(() => {});
      throw err;
    });
  } catch (err) {
    await cleanup();
    throw err;
  }

  // ── 7. Sniff the first bytes ──
  const sniffData = Buffer.concat(sniffBuffer);
  if (sniffData.length > 0) {
    const detected = await fileTypeFromBuffer(sniffData);
    detectedMime = detected?.mime;
  }

  // Special case: WebVTT and PDF may not be detected by file-type from first bytes
  // file-type detects PDF. WebVTT is text-based and won't be detected.
  if (!detectedMime && metadata.kind === 'captions') {
    // text/vtt check: first bytes should start with WEBVTT
    const header = sniffData.toString('utf-8', 0, Math.min(20, sniffData.length));
    if (header.trimStart().startsWith('WEBVTT')) {
      detectedMime = 'text/vtt';
    }
  }

  if (!detectedMime || !allowedMimes.includes(detectedMime)) {
    await cleanup();
    throw new ApiHttpException({
      status: 415,
      code: 'media_type_rejected',
      message: `Detected type '${detectedMime ?? 'unknown'}' is not allowed for kind '${metadata.kind}'`,
      details: { reason: 'type_mismatch', detected: detectedMime ?? 'unknown' },
    });
  }

  // ── 8. Verify Content-Digest ──
  const checksumSha256 = sha256.digest('hex');
  const computedB64 = Buffer.from(checksumSha256, 'hex').toString('base64');

  if (expectedDigestB64 !== null && expectedDigestB64 !== computedB64) {
    await cleanup();
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message: 'Content-Digest does not match the uploaded file',
      details: { reason: 'digest_mismatch' },
    });
  }

  // ── 9. Update the asset row with actual size and checksum ──
  await ctx.dbService.db
    .update(mediaAssets)
    .set({
      byteSize: byteCount,
      mimeType: detectedMime,
      checksumSha256,
    })
    .where(eq(mediaAssets.id, assetId));

  // ── 10. Audit ──
  await ctx.auditWriter.record({
    action: 'media.uploaded' as AuditEventInput['action'],
    actorUserId: principal.userId,
    actorKind: 'USER',
    recordType: 'media_asset',
    recordId: assetId,
    result: 'ALLOWED',
    details: { kind: metadata.kind, byteSize: byteCount },
  }).catch((err: unknown) => {
    logger.warn(`Audit write failed for media.uploaded: ${err}`);
  });

  return {
    assetId,
    state: 'uploaded',
    checksumSha256,
    byteSize: byteCount,
    detectedMime,
    metadata,
  };
}
