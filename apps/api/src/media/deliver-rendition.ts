/**
 * Shared rendition delivery helper — streams a rendition to an HTTP response
 * using Node.js `pipeline()` for proper backpressure and cleanup (C3).
 *
 * Used by both the library (employee) and ops (staff preview) controllers.
 * Handles Range headers, security headers for PDFs, cache control for card
 * images, and safe teardown on client abort or read errors.
 */
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { MediaStorage, ByteRange } from './storage/media-storage.js';
import { parseRangeHeader, resolveRange } from './range-parser.js';

/** Minimal request shape (avoids `@types/express`). */
export interface DeliverReq {
  headers: Record<string, string | string[] | undefined>;
}

/** Minimal response shape (Express-compatible). */
export interface DeliverRes {
  setHeader(name: string, value: string | number): void;
  status(code: number): DeliverRes;
  end(): void;
  /** Node.js writable interface for pipeline(). */
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface RenditionInfo {
  storageKey: string;
  mimeType: string;
  byteSize: number;
  kind?: string;
}

/**
 * Stream a rendition to the HTTP response with Range support.
 *
 * On read errors the response is ended with 500 (if headers haven't been
 * sent yet) or simply closed (if the body was already in flight).
 * On client abort, the source stream is destroyed promptly via pipeline().
 */
export async function deliverRendition(
  storage: MediaStorage,
  rendition: RenditionInfo,
  req: DeliverReq,
  res: DeliverRes,
): Promise<void> {
  const isPdf = rendition.mimeType === 'application/pdf';
  const rangeHeader = req.headers['range'] as string | undefined;
  const parsed = parseRangeHeader(rangeHeader);

  // Common headers
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', rendition.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');

  // Card images get short cache (MED-R-21)
  if (
    rendition.kind === 'card_webp' ||
    rendition.kind === 'card_jpeg'
  ) {
    res.setHeader('Cache-Control', 'private, max-age=300');
  }

  if (isPdf) {
    res.setHeader('Content-Disposition', 'attachment; filename="resource.pdf"');
    res.setHeader('Content-Security-Policy', 'sandbox');
  }

  // Unknown unit → serve full response (RFC 9110)
  if (parsed.type === 'none' || parsed.type === 'multiple' || parsed.type === 'unknown_unit') {
    const { stream, contentLength } = await storage.get(rendition.storageKey);
    res.setHeader('Content-Length', String(contentLength));
    res.status(200);
    await safePipeline(stream, res);
    return;
  }

  if (parsed.type === 'invalid') {
    // 416 without body; Content-Type already set to the rendition's type,
    // but we clear it to avoid confusion (no body follows).
    res.setHeader('Content-Range', `bytes */${rendition.byteSize}`);
    res.setHeader('Content-Type', 'text/plain');
    res.status(416).end();
    return;
  }

  // Resolve range against actual storage size
  const headResult = await storage.head(rendition.storageKey);
  const totalSize = headResult.contentLength;
  const byteRange: ByteRange | null = resolveRange(parsed, totalSize);

  if (!byteRange) {
    res.setHeader('Content-Range', `bytes */${totalSize}`);
    res.setHeader('Content-Type', 'text/plain');
    res.status(416).end();
    return;
  }

  const { stream, contentLength, contentRange } = await storage.get(
    rendition.storageKey,
    byteRange,
  );

  res.setHeader('Content-Length', String(contentLength));
  if (contentRange) {
    res.setHeader('Content-Range', contentRange);
  }
  res.status(206);
  await safePipeline(stream, res);
}

/**
 * Pipe `source` into `dest` via pipeline(). On error, destroy the source
 * and let the response finish (Express will close it).
 *
 * pipeline() handles: backpressure, source cleanup on dest abort, and
 * dest cleanup on source error — no manual .pipe() needed.
 */
async function safePipeline(
  source: Readable,
  dest: DeliverRes,
): Promise<void> {
  try {
    await pipeline(source, dest as unknown as NodeJS.WritableStream);
  } catch (err: unknown) {
    // ERR_STREAM_PREMATURE_CLOSE: client aborted — that's fine.
    if (isAbortError(err)) return;
    // Other stream error: source is already destroyed by pipeline.
    // If the response is still writable, end it.
    try { (dest as unknown as NodeJS.WritableStream).end?.(); } catch { /* already closed */ }
    throw err;
  }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'EPIPE';
}
