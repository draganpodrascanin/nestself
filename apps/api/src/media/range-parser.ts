/**
 * HTTP Range header parser (RFC 9110).
 *
 * Supports single byte ranges. Multiple ranges are treated as the full file
 * (multipart/byteranges is not implemented for V1).
 *
 * Case-insensitive unit match; unknown units fall back to 200 full (RFC 9110
 * says a server MAY ignore the Range header when the unit is not understood).
 */
import type { ByteRange } from './storage/media-storage.js';

export type ParsedRange =
  | { type: 'range'; start: number; end?: number }
  | { type: 'suffix'; suffixLength: number }
  | { type: 'none' }
  | { type: 'invalid' }
  | { type: 'multiple' }
  | { type: 'unknown_unit' };

/**
 * Parse a `Range` header value.
 */
export function parseRangeHeader(header: string | undefined): ParsedRange {
  if (!header) return { type: 'none' };

  // Case-insensitive match for "bytes=" prefix
  const match = header.match(/^bytes=(.+)$/i);
  if (!match) {
    // Check if it has a unit= pattern but not "bytes"; unknown unit → full
    if (/^[a-zA-Z]+=/.test(header)) return { type: 'unknown_unit' };
    return { type: 'invalid' };
  }

  const spec = match[1]!;

  // Reject leading/trailing whitespace inside the byte-range-set
  if (spec !== spec.trim()) return { type: 'invalid' };

  const ranges = spec.split(',').map((s) => s.trim());

  // Filter out empty parts (trailing commas like "0-99,")
  const nonEmpty = ranges.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return { type: 'invalid' };

  // Multiple ranges: treat as full (V1 simplification)
  if (nonEmpty.length > 1) return { type: 'multiple' };

  const part = nonEmpty[0]!;

  // Reject whitespace inside the range-spec ("0 -1", "0- 1")
  if (/\s/.test(part)) return { type: 'invalid' };

  // Reject hex, scientific notation, or non-decimal digits
  if (/[^0-9-]/.test(part)) return { type: 'invalid' };

  // Suffix range: bytes=-500
  const suffixMatch = part.match(/^-(\d+)$/);
  if (suffixMatch) {
    const len = parseInt(suffixMatch[1]!, 10);
    if (len === 0) return { type: 'invalid' };
    if (!Number.isSafeInteger(len)) return { type: 'invalid' };
    return { type: 'suffix', suffixLength: len };
  }

  // Bare hyphen: bytes=-
  if (part === '-') return { type: 'invalid' };

  // Open-ended: bytes=100-
  const openMatch = part.match(/^(\d+)-$/);
  if (openMatch) {
    const start = parseInt(openMatch[1]!, 10);
    if (!Number.isSafeInteger(start)) return { type: 'invalid' };
    return { type: 'range', start };
  }

  // Closed: bytes=100-200
  const closedMatch = part.match(/^(\d+)-(\d+)$/);
  if (closedMatch) {
    const start = parseInt(closedMatch[1]!, 10);
    const end = parseInt(closedMatch[2]!, 10);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { type: 'invalid' };
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
    // Suffix range on zero-length file → unsatisfiable
    if (totalSize === 0) return null;
    const start = Math.max(0, totalSize - parsed.suffixLength);
    return { start, end: totalSize - 1 };
  }
  return null;
}
