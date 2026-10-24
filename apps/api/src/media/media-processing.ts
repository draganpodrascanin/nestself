/**
 * Media processing pipeline (MED-R-07 to MED-R-13, 8.4).
 *
 * Runs in the worker process on the `nestself-media` queue. Steps:
 * 1. Magic-byte sniffing with `file-type`
 * 2. Size limits
 * 3. Malware verdict (local: not_scanned_local)
 * 4. Metadata stripping (sharp for images)
 * 5. Rendition generation
 * 6. State transition to ready or rejected
 */
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import type { MediaStorage } from './storage/media-storage.js';
import { assertTransition } from './media-state-machine.js';
import {
  MEDIA_KIND_ALLOWED_MIMES,
  MEDIA_KIND_MAX_BYTES,
  type MediaAssetState,
  type MediaKind,
  type MediaRenditionKind,
  type MediaScanStatus,
} from '@nestself/contracts';

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
 * Run the processing pipeline for one asset.
 * The caller is responsible for updating the database.
 */
export async function processMediaAsset(
  storage: MediaStorage,
  input: ProcessingInput,
): Promise<ProcessingResult> {
  const quarantineKey = `quarantine/${input.assetId}/original`;

  // Transition: uploaded -> quarantined
  assertTransition(input.currentState, 'quarantined');

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
    return {
      newState: 'rejected',
      scanStatus: 'pending',
      rejectionCode: 'type_mismatch',
      renditions: [],
      width: null,
      height: null,
      checksumSha256,
    };
  }

  // Step 2: Size limits
  if (fileBuffer.length > MEDIA_KIND_MAX_BYTES[input.kind]) {
    return {
      newState: 'rejected',
      scanStatus: 'pending',
      rejectionCode: 'size_exceeded',
      renditions: [],
      width: null,
      height: null,
      checksumSha256,
    };
  }

  // Transition: quarantined -> processing
  // Step 3: Malware verdict (local: not_scanned_local)
  const scanStatus: MediaScanStatus =
    input.nodeEnv === 'production' ? 'pending' : 'not_scanned_local';

  // In production, assets without scan cannot proceed.
  // Cast to string for the comparison because the local code path assigns
  // 'pending' | 'not_scanned_local', but the production path will be extended
  // when the malware-scan integration lands (T-C2.10).
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

  if (input.kind === 'image') {
    const result = await processImage(storage, input.assetId, fileBuffer, input.focalPoint);
    renditions.push(...result.renditions);
    width = result.width;
    height = result.height;
  } else if (input.kind === 'pdf') {
    const result = await processPdf(storage, input.assetId, fileBuffer);
    renditions.push(...result.renditions);
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

async function processImage(
  storage: MediaStorage,
  assetId: string,
  buffer: Buffer,
  focalPoint?: { x: number; y: number } | null,
): Promise<{ renditions: RenditionOutput[]; width: number; height: number }> {
  const renditions: RenditionOutput[] = [];

  // Strip metadata from original (MED-R-10): sharp's default is to strip
  // all EXIF, ICC and GPS metadata. The .rotate() call auto-orients from
  // EXIF before the rotation metadata is discarded.
  const stripped = await sharp(buffer)
    .rotate() // auto-orient from EXIF before stripping
    .toBuffer({ resolveWithObject: true });

  const { width: origW, height: origH } = stripped.info;

  // Original rendition
  const originalKey = `assets/${assetId}/original`;
  await storage.put(
    originalKey,
    Readable.from(stripped.data),
    { contentType: `image/${stripped.info.format}`, contentLength: stripped.data.length },
  );
  renditions.push({
    kind: 'original',
    width: origW,
    height: origH,
    byteSize: stripped.data.length,
    mimeType: `image/${stripped.info.format}`,
    storageKey: originalKey,
  });

  // Card renditions (640px wide, focal-point crop to 16:9)
  const cardWidth = Math.min(640, origW);
  const cardHeight = Math.round(cardWidth * 9 / 16);

  for (const format of ['webp', 'jpeg'] as const) {
    const renditionKind: MediaRenditionKind = format === 'webp' ? 'card_webp' : 'card_jpeg';
    let pipeline = sharp(stripped.data).resize({
      width: cardWidth,
      height: cardHeight,
      fit: 'cover',
      position: focalPoint
        ? `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`
        : 'centre',
    });
    if (format === 'webp') {
      pipeline = pipeline.webp({ quality: 80 });
    } else {
      pipeline = pipeline.jpeg({ quality: 80 });
    }
    const result = await pipeline.toBuffer({ resolveWithObject: true });
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
  const detailWidth = Math.min(1200, origW);

  for (const format of ['webp', 'jpeg'] as const) {
    const renditionKind: MediaRenditionKind = format === 'webp' ? 'detail_webp' : 'detail_jpeg';
    let pipeline = sharp(stripped.data).resize({ width: detailWidth, withoutEnlargement: true });
    if (format === 'webp') {
      pipeline = pipeline.webp({ quality: 85 });
    } else {
      pipeline = pipeline.jpeg({ quality: 85 });
    }
    const result = await pipeline.toBuffer({ resolveWithObject: true });
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

  return { renditions, width: origW, height: origH };
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
