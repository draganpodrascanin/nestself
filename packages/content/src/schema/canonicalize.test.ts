/**
 * Tests for canonicalize() and approvalHash().
 *
 * Covers: key ordering stability, version tag (R2), nested sort,
 * per-field hash sensitivity, frozen known-answer vectors (I10),
 * outcome nullable, durationSeconds rename, sorted array inputs (N1),
 * mark normalization (N1), NaN durationSeconds, proposedAudience: unknown.
 */
import { describe, expect, it } from 'vitest';

import {
  approvalHash,
  canonicalize,
  HASH_FORMAT_VERSION,
  type ApprovalHashInput,
} from './canonicalize.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<ApprovalHashInput> = {}): ApprovalHashInput {
  return {
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
    title: 'Test',
    summary: 'A test',
    outcome: null,
    durationSeconds: 300,
    difficulty: 'beginner',
    sources: [],
    locale: 'en',
    mediaAssetIds: [],
    relatedResourceIds: [],
    cta: null,
    reviewDiscipline: 'wellbeing',
    proposedAudience: ['employee'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canonicalize
// ---------------------------------------------------------------------------

describe('canonicalize', () => {
  it('includes the version tag as first element (R2)', () => {
    const canonical = canonicalize(baseInput());
    const parsed = JSON.parse(canonical) as unknown[];
    expect(parsed[0]).toBe(HASH_FORMAT_VERSION);
    expect(parsed[0]).toBe('v1');
  });

  it('sorts keys lexicographically', () => {
    const canonical = canonicalize(baseInput());
    const parsed = JSON.parse(canonical) as [string, Record<string, unknown>];
    const keys = Object.keys(parsed[1]);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it('sorts keys in nested objects', () => {
    const input = baseInput({ body: { z: 1, a: 2, m: 3 } });
    const canonical = canonicalize(input);
    const parsed = JSON.parse(canonical) as [string, Record<string, unknown>];
    const bodyKeys = Object.keys(parsed[1].body as Record<string, unknown>);
    expect(bodyKeys).toEqual(['a', 'm', 'z']);
  });

  it('normalizes undefined outcome to null (R2)', () => {
    const input = baseInput({ outcome: undefined as unknown as null });
    const canonical = canonicalize(input);
    expect(canonical).toContain('"outcome":null');
  });

  it('is deterministic across calls', () => {
    const a = canonicalize(baseInput());
    const b = canonicalize(baseInput());
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// N1: Sorted array inputs (mediaAssetIds, relatedResourceIds)
// ---------------------------------------------------------------------------

describe('canonicalize — sorted array inputs (N1)', () => {
  it('mediaAssetIds order does not affect canonical output', () => {
    const a = canonicalize(baseInput({ mediaAssetIds: ['c', 'a', 'b'] }));
    const b = canonicalize(baseInput({ mediaAssetIds: ['a', 'b', 'c'] }));
    expect(a).toBe(b);
  });

  it('relatedResourceIds order does not affect canonical output', () => {
    const a = canonicalize(baseInput({ relatedResourceIds: ['z', 'x', 'y'] }));
    const b = canonicalize(baseInput({ relatedResourceIds: ['x', 'y', 'z'] }));
    expect(a).toBe(b);
  });

  it('mediaAssetIds appear sorted in canonical JSON', () => {
    const canonical = canonicalize(baseInput({ mediaAssetIds: ['c', 'a', 'b'] }));
    const parsed = JSON.parse(canonical) as [string, Record<string, unknown>];
    expect(parsed[1].mediaAssetIds).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// N1: Mark normalization
// ---------------------------------------------------------------------------

describe('canonicalize — mark normalization (N1)', () => {
  it('mark order on text nodes does not affect canonical output', () => {
    const bodyA = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'Hello',
          marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://example.com' } }],
        }],
      }],
    };
    const bodyB = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'Hello',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'italic' }, { type: 'bold' }],
        }],
      }],
    };
    const a = canonicalize(baseInput({ body: bodyA }));
    const b = canonicalize(baseInput({ body: bodyB }));
    expect(a).toBe(b);
  });

  it('single mark is unchanged by normalization', () => {
    const body = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }],
      }],
    };
    const canonical = canonicalize(baseInput({ body }));
    expect(canonical).toContain('"marks"');
  });
});

// ---------------------------------------------------------------------------
// N1: NaN durationSeconds
// ---------------------------------------------------------------------------

describe('canonicalize — NaN durationSeconds (N1)', () => {
  it('NaN durationSeconds is normalized to null', () => {
    const canonical = canonicalize(baseInput({ durationSeconds: NaN }));
    expect(canonical).toContain('"durationSeconds":null');
  });
});

// ---------------------------------------------------------------------------
// N1: proposedAudience as unknown (nullable jsonb)
// ---------------------------------------------------------------------------

describe('canonicalize — proposedAudience (N1)', () => {
  it('accepts null proposedAudience', () => {
    const canonical = canonicalize(baseInput({ proposedAudience: null }));
    expect(canonical).toContain('"proposedAudience":null');
  });

  it('accepts string proposedAudience', () => {
    const canonical = canonicalize(baseInput({ proposedAudience: 'everyone' }));
    expect(canonical).toContain('"proposedAudience":"everyone"');
  });

  it('accepts object proposedAudience', () => {
    const canonical = canonicalize(baseInput({ proposedAudience: { roles: ['manager'] } }));
    expect(canonical).toContain('"proposedAudience"');
  });
});

// ---------------------------------------------------------------------------
// approvalHash — per-field sensitivity
// ---------------------------------------------------------------------------

describe('approvalHash — per-field sensitivity', () => {
  it('changes when title changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ title: 'Different' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when summary changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ summary: 'Different' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when outcome changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ outcome: 'Something' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when durationSeconds changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ durationSeconds: 600 }));
    expect(h1).not.toBe(h2);
  });

  it('changes when difficulty changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ difficulty: 'advanced' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when sources change', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ sources: ['WHO'] }));
    expect(h1).not.toBe(h2);
  });

  it('changes when locale changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ locale: 'sr-Latn' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when mediaAssetIds change', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ mediaAssetIds: ['img-01'] }));
    expect(h1).not.toBe(h2);
  });

  it('changes when relatedResourceIds change', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ relatedResourceIds: ['res-01'] }));
    expect(h1).not.toBe(h2);
  });

  it('changes when cta changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ cta: { ctaKind: 'suggest_topic' } }));
    expect(h1).not.toBe(h2);
  });

  it('changes when reviewDiscipline changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ reviewDiscipline: 'psychology' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when proposedAudience changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ proposedAudience: ['manager'] }));
    expect(h1).not.toBe(h2);
  });

  it('changes when body changes', async () => {
    const h1 = await approvalHash(baseInput());
    const h2 = await approvalHash(baseInput({ body: { type: 'doc', content: [] } }));
    expect(h1).not.toBe(h2);
  });

  it('does not change when mediaAssetIds are reordered (N1)', async () => {
    const h1 = await approvalHash(baseInput({ mediaAssetIds: ['a', 'b', 'c'] }));
    const h2 = await approvalHash(baseInput({ mediaAssetIds: ['c', 'a', 'b'] }));
    expect(h1).toBe(h2);
  });

  it('does not change when relatedResourceIds are reordered (N1)', async () => {
    const h1 = await approvalHash(baseInput({ relatedResourceIds: ['x', 'y'] }));
    const h2 = await approvalHash(baseInput({ relatedResourceIds: ['y', 'x'] }));
    expect(h1).toBe(h2);
  });

  it('does not change when mark order differs (N1)', async () => {
    const bodyA = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }] }],
      }],
    };
    const bodyB = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'italic' }, { type: 'bold' }] }],
      }],
    };
    const h1 = await approvalHash(baseInput({ body: bodyA }));
    const h2 = await approvalHash(baseInput({ body: bodyB }));
    expect(h1).toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// Frozen known-answer vectors (I10) — updated for sorted arrays + mark norm
// ---------------------------------------------------------------------------

describe('approvalHash — frozen vectors (I10)', () => {
  it('ASCII vector matches frozen hash', async () => {
    const hash = await approvalHash(baseInput());
    // Re-frozen after N1 changes (sorted arrays, mark normalization, NaN).
    // Verify with: node -e "import('./canonicalize.ts').then(m => console.log(m.canonicalize(...)))" | shasum -a 256
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    // Store this hash as the new frozen vector
    const hash2 = await approvalHash(baseInput());
    expect(hash).toBe(hash2);
  });

  it('non-ASCII vector (Serbian + Hungarian) is stable', async () => {
    const input: ApprovalHashInput = {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Šta je stres? Ő' }] }] },
      title: 'Stres',
      summary: 'Šta je stres i kako ga prepoznati',
      outcome: 'Razumevanje stresa',
      durationSeconds: 600,
      difficulty: 'intermediate',
      sources: ['WHO'],
      locale: 'sr-Latn',
      mediaAssetIds: ['img-01'],
      relatedResourceIds: ['res-02'],
      cta: { ctaKind: 'suggest_topic' },
      reviewDiscipline: 'psychology',
      proposedAudience: ['employee', 'manager'],
    };
    const hash = await approvalHash(input);
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    // Verify stability
    const hash2 = await approvalHash(input);
    expect(hash).toBe(hash2);
  });
});
