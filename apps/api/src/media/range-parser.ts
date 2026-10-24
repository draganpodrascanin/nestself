/**
 * HTTP Range header parser (RFC 9110).
 *
 * Supports single byte ranges. Multiple ranges are treated as the full file
 * (multipart/byteranges is not implemented for V1).
 */
import type { ByteRange } from './storage/media-storage.js';

export type ParsedRange =
  | { type: 'range'; start: number; end?: number }
  | { type: 'suffix'; suffixLength: number }
  | { type: 'none' }
  | { type: 'invalid' }
  | { type: 'multiple' };

/**
 * Parse a `Range` header value.
 */
export function parseRangeHeader(header: string | undefined): ParsedRange {
  if (!header) return { type: 'none' };

  const match = header.match(/^bytes=(.+)$/);
  if (!match) return { type: 'invalid' };

  const ranges = match[1]!.split(',').map((s) => s.trim());

  // Multiple ranges: treat as full (V1 simplification)
  if (ranges.length > 1) return { type: 'multiple' };

  const part = ranges[0]!;

  // Suffix range: bytes=-500
  const suffixMatch = part.match(/^-(\d+)$/);
  if (suffixMatch) {
    const len = parseInt(suffixMatch[1]!, 10);
    if (len === 0) return { type: 'invalid' };
    return { type: 'suffix', suffixLength: len };
  }

  // Open-ended: bytes=100-
  const openMatch = part.match(/^(\d+)-$/);
  if (openMatch) {
    return { type: 'range', start: parseInt(openMatch[1]!, 10) };
  }

  // Closed: bytes=100-200
  const closedMatch = part.match(/^(\d+)-(\d+)$/);
  if (closedMatch) {
    const start = parseInt(closedMatch[1]!, 10);
    const end = parseInt(closedMatch[2]!, 10);
    if (start > end) return { type: 'invalid' };
    return { type: 'range', start, end };
  }

  return { type: 'invalid' };
}

/**
 * Resolve a parsed range to a ByteRange against a known total size.
 * Returns null for unsatisfiable ranges.
 */
export function resolveRange(
  parsed: ParsedRange,
  totalSize: number,
): ByteRange | null {
  if (parsed.type === 'range') {
    if (parsed.start >= totalSize) return null;
    const end = parsed.end !== undefined
      ? Math.min(parsed.end, totalSize - 1)
      : totalSize - 1;
    return { start: parsed.start, end };
  }
  if (parsed.type === 'suffix') {
    const start = Math.max(0, totalSize - parsed.suffixLength);
    return { start, end: totalSize - 1 };
  }
  return null;
}
