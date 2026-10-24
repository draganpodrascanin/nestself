/**
 * Canonicalization and approval hashing (FMT-R-08, FMT-R-09, C-06).
 *
 * `canonicalize(input)` produces a deterministic JSON string from the
 * fields of a content revision that bind the approval hash. Keys are
 * sorted recursively, arrays preserve order, `undefined` values are
 * dropped, and there is no insignificant whitespace.
 *
 * `approvalHash(input)` computes SHA-256 hex over the canonical form
 * using the Web Crypto API (`globalThis.crypto.subtle`), which works
 * in both Node.js (20+) and browsers. For synchronous hashing on the
 * server, import `approvalHashSync` from `@nestself/content/schema/node`
 * (a separate subpath that uses `node:crypto` and is excluded from
 * browser bundles).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for the approval hash. The field list matches C-06 / FMT-R-08
 * exactly, in canonical order:
 *
 * 1. body        — the ContentDocument JSON
 * 2. title       — revision metadata
 * 3. summary     — revision metadata
 * 4. outcome     — revision metadata
 * 5. duration    — revision metadata (minutes, optional)
 * 6. difficulty  — revision metadata (optional)
 * 7. sources     — revision metadata (optional)
 * 8. locale      — the variant's locale
 * 9. mediaAssetIds     — sorted array from content_revision_media
 * 10. relatedResourceIds — sorted array
 * 11. cta               — the CTA node's JSON, or null
 * 12. reviewDiscipline  — the review discipline
 * 13. proposedAudience  — sorted JSON of the proposed_audience column
 */
export interface ApprovalHashInput {
  body: unknown;
  title: string;
  summary: string;
  outcome: string;
  duration?: number | null;
  difficulty?: string | null;
  sources?: string[] | null;
  locale: string;
  mediaAssetIds: string[];
  relatedResourceIds: string[];
  cta: unknown | null;
  reviewDiscipline: string;
  proposedAudience: unknown;
}

// ---------------------------------------------------------------------------
// Canonicalize
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic JSON string by sorting object keys recursively,
 * preserving array order, and dropping `undefined` values.
 */
function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = sortKeys(v);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Produce a deterministic canonical JSON string from an `ApprovalHashInput`.
 *
 * The output is a JSON array of the fields in the order defined by
 * FMT-R-08, with every nested object key-sorted and no insignificant
 * whitespace.
 */
export function canonicalize(input: ApprovalHashInput): string {
  const canonical = [
    sortKeys(input.body),
    input.title,
    input.summary,
    input.outcome,
    input.duration ?? null,
    input.difficulty ?? null,
    sortKeys(input.sources ?? null),
    input.locale,
    [...input.mediaAssetIds].sort(),
    [...input.relatedResourceIds].sort(),
    input.cta !== null && input.cta !== undefined ? sortKeys(input.cta) : null,
    input.reviewDiscipline,
    sortKeys(input.proposedAudience),
  ];

  return JSON.stringify(canonical);
}

// ---------------------------------------------------------------------------
// Approval hash (async — Web Crypto API, browser-safe)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of the canonical form of a revision's
 * approval-hash fields.
 *
 * Uses `globalThis.crypto.subtle`, which is available in both Node.js 20+
 * and browsers. For a synchronous API on the server, see `approvalHashSync`
 * in `@nestself/content/schema/node`.
 */
export async function approvalHash(input: ApprovalHashInput): Promise<string> {
  const canonical = canonicalize(input);
  const data = new TextEncoder().encode(canonical);
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
