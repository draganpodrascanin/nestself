/**
 * Tests for two-layer validation: validateContentDocument().
 *
 * Covers: transcript rules (orphans, duplicates), count constraints,
 * size limit (R3, UTF-8 bytes), text length limits (I2), schema
 * version check (I7/I8), ProseMirror value, bounded nesting (I3).
 *
 * XSS/injection tests are in xss.test.ts (R5).
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_HEADING_TEXT,
  MAX_PARAGRAPH_TEXT,
  MAX_RELATED_RESOURCES,
  MAX_TRANSCRIPT_TEXT,
} from './document.ts';
import { validateContentDocument, type ValidationResult } from './validate.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(content: unknown[]) {
  return { type: 'doc', schemaVersion: 1, content };
}

function paragraph(text = 'Hello') {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const ALLOWLIST = ['example.com', 'nestself.com'];

function validate(docObj: unknown): ValidationResult {
  return validateContentDocument(docObj, { linkHostAllowlist: ALLOWLIST });
}

// ---------------------------------------------------------------------------
// Valid documents pass both layers
// ---------------------------------------------------------------------------

describe('validateContentDocument — valid', () => {
  it('accepts a minimal valid document', () => {
    expect(validate(doc([paragraph()])).ok).toBe(true);
  });

  it('accepts a document with all block types', () => {
    const result = validate(doc([
      { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      paragraph('Body text'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Item')] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('Ordered')] }] },
      { type: 'quote', attrs: { attribution: 'Author' }, content: [paragraph('A quote')] },
      { type: 'image', attrs: { mediaAssetId: 'img-1', alt: 'Photo', caption: 'Fig 1' } },
      { type: 'professionalNote', attrs: { noteKind: 'tip' }, content: [paragraph('A tip')] },
      { type: 'practicalStep', attrs: { stepNumber: 1, title: 'Step one' }, content: [paragraph('Do this')] },
      { type: 'checklist', content: [{ type: 'checklistItem', attrs: { label: 'Check' } }] },
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [paragraph('Transcript')] },
      { type: 'relatedResource', attrs: { contentResourceId: 'res-1' } },
      { type: 'cta', attrs: { ctaKind: 'suggest_topic' } },
    ]));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transcript rules (FMT-R-23, 17)
// ---------------------------------------------------------------------------

describe('validateContentDocument — transcript rule', () => {
  it('rejects audio approvedMedia without following transcript', () => {
    const result = validate(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      paragraph('No transcript here'),
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_missing_required')).toBe(true);
  });

  it('rejects video approvedMedia without following transcript', () => {
    const result = validate(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'vid-1', kind: 'video' } },
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_missing_required')).toBe(true);
  });

  it('rejects transcript with mismatched mediaAssetId', () => {
    const result = validate(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'WRONG' }, content: [paragraph('text')] },
    ]));
    expect(result.ok).toBe(false);
  });

  it('accepts pdf approvedMedia without transcript', () => {
    expect(validate(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'pdf-1', kind: 'pdf' } },
    ])).ok).toBe(true);
  });

  it('accepts audio with correctly following transcript', () => {
    expect(validate(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [paragraph('text')] },
    ])).ok).toBe(true);
  });

  it('rejects orphan transcript (17)', () => {
    const result = validate(doc([
      { type: 'transcript', attrs: { mediaAssetId: 'orphan-1' }, content: [paragraph('text')] },
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_missing_required')).toBe(true);
  });

  it('rejects a second transcript for the same media (17)', () => {
    const result = validate(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [paragraph('text')] },
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [paragraph('duplicate')] },
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.message.includes('Duplicate transcript'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Count constraints
// ---------------------------------------------------------------------------

describe('validateContentDocument — count constraints', () => {
  it('rejects two CTAs', () => {
    const result = validate(doc([
      { type: 'cta', attrs: { ctaKind: 'suggest_topic' } },
      { type: 'cta', attrs: { ctaKind: 'open_content', targetId: 'res-1' } },
    ]));
    expect(result.ok).toBe(false);
  });

  it('rejects four relatedResource nodes', () => {
    const nodes = Array.from({ length: MAX_RELATED_RESOURCES + 1 }, (_, i) => ({
      type: 'relatedResource', attrs: { contentResourceId: `res-${i}` },
    }));
    expect(validate(doc(nodes)).ok).toBe(false);
  });

  it('accepts exactly three relatedResource nodes', () => {
    const nodes = Array.from({ length: MAX_RELATED_RESOURCES }, (_, i) => ({
      type: 'relatedResource', attrs: { contentResourceId: `res-${i}` },
    }));
    expect(validate(doc(nodes)).ok).toBe(true);
  });

  it('accepts exactly one CTA', () => {
    expect(validate(doc([{ type: 'cta', attrs: { ctaKind: 'suggest_topic' } }])).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Size limit (R3)
// ---------------------------------------------------------------------------

describe('validateContentDocument — size limit (R3)', () => {
  it('rejects oversized documents (UTF-8 bytes)', () => {
    const bigText = 'x'.repeat(4999);
    const nodes = Array.from({ length: 42 }, () => paragraph(bigText));
    const result = validate(doc(nodes));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_too_large')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Text length limits (I2)
// ---------------------------------------------------------------------------

describe('validateContentDocument — text length limits (I2)', () => {
  it('rejects sectionHeading text exceeding MAX_HEADING_TEXT', () => {
    const result = validate(doc([{
      type: 'sectionHeading', attrs: { level: 2 },
      content: [{ type: 'text', text: 'x'.repeat(MAX_HEADING_TEXT + 1) }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.path).toBe('content.0');
  });

  it('accepts sectionHeading text at exactly MAX_HEADING_TEXT', () => {
    expect(validate(doc([{
      type: 'sectionHeading', attrs: { level: 2 },
      content: [{ type: 'text', text: 'x'.repeat(MAX_HEADING_TEXT) }],
    }])).ok).toBe(true);
  });

  it('rejects paragraph whose total text exceeds MAX_PARAGRAPH_TEXT', () => {
    // Use multiple text nodes that individually fit the Zod .max(5000) per-node
    // limit but collectively exceed MAX_PARAGRAPH_TEXT.
    const perNode = Math.ceil((MAX_PARAGRAPH_TEXT + 1) / 3);
    const para = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'x'.repeat(perNode) },
        { type: 'text', text: 'x'.repeat(perNode) },
        { type: 'text', text: 'x'.repeat(perNode) },
      ],
    };
    const result = validate(doc([para]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.path).toBe('content.0');
  });

  it('accepts paragraph text at exactly MAX_PARAGRAPH_TEXT', () => {
    // Single text node at 5000 is within both per-node .max(5000) and total limit.
    expect(validate(doc([paragraph('x'.repeat(MAX_PARAGRAPH_TEXT))])).ok).toBe(true);
  });

  it('rejects transcript text exceeding MAX_TRANSCRIPT_TEXT', () => {
    // Use enough paragraphs to exceed the limit
    const charsPerPara = Math.ceil((MAX_TRANSCRIPT_TEXT + 1) / 5);
    const paras = Array.from({ length: 5 }, () => paragraph('x'.repeat(charsPerPara)));
    const result = validate(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: paras },
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path === 'content.1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema version (I7, I8)
// ---------------------------------------------------------------------------

describe('validateContentDocument — schema version (I7, I8)', () => {
  it('rejects documents with wrong schemaVersion', () => {
    const result = validate({ type: 'doc', schemaVersion: 99, content: [paragraph()] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_schema_version')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ProseMirror layer (I16)
// ---------------------------------------------------------------------------

describe('validateContentDocument — ProseMirror adds value', () => {
  it('rejects a text node as a direct child of doc', () => {
    expect(validate({ type: 'doc', schemaVersion: 1, content: [{ type: 'text', text: 'orphan' }] }).ok).toBe(false);
  });

  it('ProseMirror rejects hardBreak in sectionHeading (R1)', () => {
    expect(validate(doc([{
      type: 'sectionHeading', attrs: { level: 2 },
      content: [{ type: 'text', text: 'Title' }, { type: 'hardBreak' }],
    }])).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I3: Deeply-nested lists return error, not throw
// ---------------------------------------------------------------------------

describe('validateContentDocument — bounded nesting (I3)', () => {
  it('500-level nesting returns error result, not throw', () => {
    let innerContent: unknown = [paragraph('leaf')];
    for (let i = 0; i < 500; i++) {
      innerContent = [{
        type: 'bulletList',
        content: [{ type: 'listItem', content: innerContent }],
      }];
    }
    const result = validate(doc(innerContent as unknown[]));
    expect(result.ok).toBe(false);
  });
});
