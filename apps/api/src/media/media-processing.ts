/**
 * Media processing pipeline (MED-R-07 to MED-R-13, 8.4).
 *
 * Runs in the worker process on the `nestself-media` queue. Steps:
 * 1. Magic-byte sniffing with `file-type`
 * 2. Size limits
 * 3. Format validation (sniffed type must match declared kind)
 * 4. Malware verdict (local: not_scanned_local)
 * 5. Metadata stripping (sharp for images) with safety limits
 * 6. Rendition generation
 * 7. State transition to ready or rejected
 *
 * Sharp safety: limitInputPixels 40 000 000, failOn 'error',
 * animated images rejected, original re-encoded to max 4096px long edge.
 */
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import type { MediaStorage } from './storage/media-storage.js';
import {
  MEDIA_KIND_ALLOWED_MIMES,
  MEDIA_KIND_MAX_BYTES,
  type MediaAssetState,
  type MediaKind,
  type MediaRenditionKind,
  type MediaScanStatus,
} from '@nestself/contracts';

/** Maximum input pixels for sharp (40 megapixels). */
const LIMIT_INPUT_PIXELS = 40_000_000;
/** Maximum long edge for the stored original (px). */
const MAX_ORIGINAL_LONG_EDGE = 4096;

export interface ProcessingInput {
  assetId: string;
  kind: MediaKind;
  currentState: MediaAssetState;
  focalPoint?: { x: number; y: number } | null;
  nodeEnv: string;
}

export interface RenditionOutput {
  kind: MediaRenditionKind;
  width: number | null;
  height: number | null;
  byteSize: number;
  mimeType: string;
  storageKey: string;
}

export interface ProcessingResult {
  newState: MediaAssetState;
  scanStatus: MediaScanStatus;
  rejectionCode: string | null;
  renditions: RenditionOutput[];
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
}

/**
 * Mapping from sniffed MIME to sharp format name for re-encoding.
 */
const MIME_TO_FORMAT: Record<string, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Run the processing pipeline for one asset.
 * The caller is responsible for updating the database.
 *
 * Reprocessing a non-uploaded asset throws (the caller must use UPDATE ...
 * WHERE state = 'uploaded' RETURNING to claim the job).
 */
export async function processMediaAsset(
  storage: MediaStorage,
  input: ProcessingInput,
): Promise<ProcessingResult> {
  // Guard: only uploaded assets can enter processing.
  if (input.currentState !== 'uploaded') {
    throw new Error(
      `Cannot process asset ${input.assetId}: state is '${input.currentState}', expected 'uploaded'`,
    );
  }

  const quarantineKey = `quarantine/${input.assetId}/original`;

  // Step 1: Read the quarantined file for magic-byte sniffing
  const { stream: readStream } = await storage.get(quarantineKey);
  const chunks: Buffer[] = [];
  for await (const chunk of readStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const fileBuffer = Buffer.concat(chunks);

  // Compute checksum
  const checksumSha256 = createHash('sha256').update(fileBuffer).digest('hex');

  // Magic-byte detection
  const detected = await fileTypeFromBuffer(fileBuffer);
  const allowedMimes = MEDIA_KIND_ALLOWED_MIMES[input.kind];
  const detectedMime = detected?.mime;

  // For PDFs, file-type detects 'application/pdf'
  if (!detectedMime || !allowedMimes.includes(detectedMime)) {
    return rejected('type_mismatch', checksumSha256);
  }

  // Step 2: Size limits
  if (fileBuffer.length > MEDIA_KIND_MAX_BYTES[input.kind]) {
    return rejected('size_exceeded', checksumSha256);
  }

  // Step 3: Malware verdict (local: not_scanned_local)
  const scanStatus: MediaScanStatus =
    input.nodeEnv === 'production' ? 'pending' : 'not_scanned_local';

  if (input.nodeEnv === 'production' && (scanStatus as string) !== 'no_threats_found') {
    return {
      newState: 'rejected',
      scanStatus,
      rejectionCode: 'scan_required_in_production',
      renditions: [],
      width: null,
      height: null,
      checksumSha256,
    };
  }

  // Step 4 & 5: Kind-specific processing
  const renditions: RenditionOutput[] = [];
  let width: number | null = null;
  let height: number | null = null;

  try {
    if (input.kind === 'image') {
      const result = await processImage(
        storage,
        input.assetId,
        fileBuffer,
        detectedMime,
        input.focalPoint,
      );
      renditions.push(...result.renditions);
      width = result.width;
      height = result.height;
    } else if (input.kind === 'pdf') {
      const result = await processPdf(storage, input.assetId, fileBuffer);
      renditions.push(...result.renditions);
    }
  } catch (err) {
    // Processing failure (corrupt image, pixel bomb, animated image, etc.)
    // → reject the asset rather than leaving it stuck in processing.
    const code = err instanceof ProcessingRejection ? err.code : 'processing_error';
    return rejected(code, checksumSha256);
  }

  return {
    newState: 'ready',
    scanStatus,
    rejectionCode: null,
    renditions,
    width,
    height,
    checksumSha256,
  };
}

/** Helper for building a rejected result. */
function rejected(code: string, checksumSha256: string | null): ProcessingResult {
  return {
    newState: 'rejected',
    scanStatus: 'pending',
    rejectionCode: code,
    renditions: [],
    width: null,
    height: null,
    checksumSha256,
  };
}

/** Thrown by processing steps to trigger a clean rejection. */
class ProcessingRejection extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ProcessingRejection';
  }
}

async function processImage(
  storage: MediaStorage,
  assetId: string,
  buffer: Buffer,
  detectedMime: string,
  focalPoint?: { x: number; y: number } | null,
): Promise<{ renditions: RenditionOutput[]; width: number; height: number }> {
  const renditions: RenditionOutput[] = [];

  // Determine expected format from sniffed MIME
  const expectedFormat = MIME_TO_FORMAT[detectedMime];
  if (!expectedFormat) {
    throw new ProcessingRejection('type_mismatch', `No format mapping for ${detectedMime}`);
  }

  // Pre-flight: check metadata with safety limits
  const meta = await sharp(buffer, {
    limitInputPixels: LIMIT_INPUT_PIXELS,
    failOn: 'error',
  }).metadata();

  // Reject animated images (GIF, animated WebP, animated PNG)
  if (meta.pages && meta.pages > 1) {
    throw new ProcessingRejection(
      'animated_not_supported',
      'Animated images are not supported',
    );
  }

  // Verify sniffed format matches sharp's detection
  if (meta.format && MIME_TO_FORMAT[`image/${meta.format}`] !== expectedFormat) {
    throw new ProcessingRejection(
      'format_mismatch',
      `Sharp detected ${meta.format} but file-type said ${detectedMime}`,
    );
  }

  // Strip metadata from original (MED-R-10): sharp's default is to strip
  // all EXIF, ICC and GPS metadata. The .rotate() call auto-orients from
  // EXIF before the rotation metadata is discarded.
  //
  // Re-encode the original to:
  // - strip metadata
  // - cap the long edge at MAX_ORIGINAL_LONG_EDGE px
  // - ensure the stored format matches the sniffed format
  let pipeline = sharp(buffer, {
    limitInputPixels: LIMIT_INPUT_PIXELS,
    failOn: 'error',
  })
    .rotate(); // auto-orient from EXIF before stripping

  // Cap long edge
  const origW = meta.width ?? 0;
  const origH = meta.height ?? 0;
  const longEdge = Math.max(origW, origH);
  if (longEdge > MAX_ORIGINAL_LONG_EDGE) {
    if (origW >= origH) {
      pipeline = pipeline.resize({ width: MAX_ORIGINAL_LONG_EDGE, withoutEnlargement: true });
    } else {
      pipeline = pipeline.resize({ height: MAX_ORIGINAL_LONG_EDGE, withoutEnlargement: true });
    }
  }

  // Re-encode in the detected format
  if (expectedFormat === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 90 });
  } else if (expectedFormat === 'png') {
    pipeline = pipeline.png();
  } else if (expectedFormat === 'webp') {
    pipeline = pipeline.webp({ quality: 90 });
  }

  const stripped = await pipeline.toBuffer({ resolveWithObject: true });
  const { width: finalW, height: finalH } = stripped.info;

  // Original rendition
  const originalKey = `assets/${assetId}/original`;
  const originalMime = `image/${expectedFormat}`;
  await storage.put(
    originalKey,
    Readable.from(stripped.data),
    { contentType: originalMime, contentLength: stripped.data.length },
  );
  renditions.push({
    kind: 'original',
    width: finalW,
    height: finalH,
    byteSize: stripped.data.length,
    mimeType: originalMime,
    storageKey: originalKey,
  });

  // Card renditions (640px wide, focal-point crop to 16:9)
  const cardWidth = Math.min(640, finalW);
  const cardHeight = Math.round(cardWidth * 9 / 16);

  for (const format of ['webp', 'jpeg'] as const) {
    const renditionKind: MediaRenditionKind = format === 'webp' ? 'card_webp' : 'card_jpeg';
    let cardPipeline = sharp(stripped.data, {
      limitInputPixels: LIMIT_INPUT_PIXELS,
      failOn: 'error',
    }).resize({
      width: cardWidth,
      height: cardHeight,
      fit: 'cover',
      position: focalPoint
        ? `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`
        : 'centre',
    });
    if (format === 'webp') {
      cardPipeline = cardPipeline.webp({ quality: 80 });
    } else {
      cardPipeline = cardPipeline.jpeg({ quality: 80 });
    }
    const result = await cardPipeline.toBuffer({ resolveWithObject: true });
    const key = `assets/${assetId}/${renditionKind}`;
    await storage.put(
      key,
      Readable.from(result.data),
      { contentType: `image/${format}`, contentLength: result.data.length },
    );
    renditions.push({
      kind: renditionKind,
      width: result.info.width,
      height: result.info.height,
      byteSize: result.data.length,
      mimeType: `image/${format}`,
      storageKey: key,
    });
  }

  // Detail renditions (1200px wide)
  const detailWidth = Math.min(1200, finalW);

  for (const format of ['webp', 'jpeg'] as const) {
    const renditionKind: MediaRenditionKind = format === 'webp' ? 'detail_webp' : 'detail_jpeg';
    let detailPipeline = sharp(stripped.data, {
      limitInputPixels: LIMIT_INPUT_PIXELS,
      failOn: 'error',
    }).resize({ width: detailWidth, withoutEnlargement: true });
    if (format === 'webp') {
      detailPipeline = detailPipeline.webp({ quality: 85 });
    } else {
      detailPipeline = detailPipeline.jpeg({ quality: 85 });
    }
    const result = await detailPipeline.toBuffer({ resolveWithObject: true });
    const key = `assets/${assetId}/${renditionKind}`;
    await storage.put(
      key,
      Readable.from(result.data),
      { contentType: `image/${format}`, contentLength: result.data.length },
    );
    renditions.push({
      kind: renditionKind,
      width: result.info.width,
      height: result.info.height,
      byteSize: result.data.length,
      mimeType: `image/${format}`,
      storageKey: key,
    });
  }

  return { renditions, width: finalW, height: finalH };
}

async function processPdf(
  storage: MediaStorage,
  assetId: string,
  buffer: Buffer,
): Promise<{ renditions: RenditionOutput[] }> {
  // PDFs are served as-is (no metadata stripping per MED-R-11)
  const key = `assets/${assetId}/pdf`;
  await storage.put(
    key,
    Readable.from(buffer),
    { contentType: 'application/pdf', contentLength: buffer.length },
  );
  return {
    renditions: [{
      kind: 'pdf',
      width: null,
      height: null,
      byteSize: buffer.length,
      mimeType: 'application/pdf',
      storageKey: key,
    }],
  };
}
