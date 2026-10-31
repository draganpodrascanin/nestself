/**
 * Canonicalization and approval hashing (FMT-R-08, FMT-R-09, C-06).
 *
 * The approval hash covers a fixed set of fields from the content
 * resource, serialized as deterministic JSON (sorted keys, no
 * whitespace, undefined normalized to null) and hashed with SHA-256.
 *
 * R2: A version tag ('v1') is prepended to the hashed structure so
 * any future field change is explicit and detectable.
 *
 * The hash is always computed via the async Web Crypto API (I9).
 */

// ---------------------------------------------------------------------------
// Hash-format version (R2)
// ---------------------------------------------------------------------------

/**
 * The version tag prepended to the canonical structure before hashing.
 * Increment when the set of hashed fields changes.
 */
export const HASH_FORMAT_VERSION = 'v1';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * The fields included in the approval hash.
 * `outcome` is `string | null`; canonicalized with `?? null` (R2).
 */
export interface ApprovalHashInput {
  body: unknown;
  title: string;
  summary: string;
  outcome: string | null;
  durationSeconds: number;
  difficulty: string;
  sources: string[];
  locale: string;
  mediaAssetIds: string[];
  relatedResourceIds: string[];
  cta: unknown;
  reviewDiscipline: string;
  /** Nullable jsonb column — canonicalized through sortKeys. */
  proposedAudience: unknown;
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/**
 * Recursively sort object keys. Arrays are preserved in order.
 * Returns a new object tree built with `Object.create(null)` (17).
 */
function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const sorted = Object.create(null) as Record<string, unknown>;
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Normalize mark order on text nodes so equivalent documents hash equally.
 * Sorts marks by `type` lexicographically. Operates on a deep-cloned tree.
 */
function normalizeMarks(node: unknown): unknown {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(normalizeMarks);
  const obj = node as Record<string, unknown>;
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    out[key] = normalizeMarks(obj[key]);
  }
  if (
    out.type === 'text' &&
    Array.isArray(out.marks) &&
    out.marks.length > 1
  ) {
    out.marks = [...(out.marks as Array<{ type: string }>)].sort((a, b) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
    );
  }
  return out;
}

/**
 * Produce a deterministic JSON string for the given approval-hash input.
 *
 * Rules:
 * - Keys sorted lexicographically at every level
 * - No whitespace
 * - `undefined` normalized to `null`
 * - Array-valued fields `mediaAssetIds` and `relatedResourceIds` are sorted
 *   before hashing so insertion order does not affect the hash (FMT-R-08)
 * - Mark order on text nodes is normalized (sorted by type)
 * - The version tag is prepended as the first element of a wrapping array
 */
export function canonicalize(input: ApprovalHashInput): string {
  const normalized: Record<string, unknown> = {
    body: normalizeMarks(input.body),
    title: input.title,
    summary: input.summary,
    outcome: input.outcome ?? null,
    durationSeconds: typeof input.durationSeconds === 'number' && !Number.isNaN(input.durationSeconds)
      ? input.durationSeconds
      : null,
    difficulty: input.difficulty,
    sources: input.sources,
    locale: input.locale,
    mediaAssetIds: [...input.mediaAssetIds].sort(),
    relatedResourceIds: [...input.relatedResourceIds].sort(),
    cta: input.cta,
    reviewDiscipline: input.reviewDiscipline,
    proposedAudience: input.proposedAudience,
  };

  const sorted = sortKeys(normalized);
  // R2: version tag as first element of wrapping array
  return JSON.stringify([HASH_FORMAT_VERSION, sorted]);
}

// ---------------------------------------------------------------------------
// Async SHA-256 hash (Web Crypto API)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 approval hash of a content resource.
 *
 * Uses the Web Crypto API (available in browsers and Node.js 18+).
 * Returns a lowercase hex string.
 */
export async function approvalHash(input: ApprovalHashInput): Promise<string> {
  const canonical = canonicalize(input);
  const encoded = new TextEncoder().encode(canonical);
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
