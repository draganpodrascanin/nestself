/**
 * Tests for canonicalize() and approvalHash().
 *
 * Covers: key ordering stability, version tag (R2), nested sort,
 * per-field hash sensitivity, frozen known-answer vectors (I10),
 * outcome nullable, durationSeconds rename.
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
});

// ---------------------------------------------------------------------------
// Frozen known-answer vectors (I10)
// ---------------------------------------------------------------------------

describe('approvalHash — frozen vectors (I10)', () => {
  it('ASCII vector matches frozen hash', async () => {
    // Verified independently with:
    // printf '%s' '<canonical>' | shasum -a 256
    const hash = await approvalHash(baseInput());
    expect(hash).toBe('91f0e4f82c793d6ab9be37e9da50ed943b51c363c02d5116a7a92cc927b429a4');
  });

  it('non-ASCII vector (Serbian + Hungarian) matches frozen hash', async () => {
    // Contains "Šta je stres? Ő" — multi-byte UTF-8
    // Verified independently with:
    // printf '%s' '<canonical>' | shasum -a 256
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
    expect(hash).toBe('d6037c740d1f06cadfb8a9777b669626a89bd6e15491b8b9e8c26fbd8e00f1b0');
  });
});
