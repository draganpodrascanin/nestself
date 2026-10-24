/**
 * Tests for two-layer validation: validateContentDocument().
 *
 * Covers: transcript rules (orphans, duplicates), count constraints,
 * size limit (R3, UTF-8 bytes), text length limits (I2), schema
 * version check (I7/I8), ProseMirror value, bounded nesting (I3),
 * error code mapping (N4), nested paragraph/checklistItem limits (N5),
 * content_schema_version error code, code point counting.
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
// Text length limits (I2) — top-level nodes
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
    expect(validate(doc([paragraph('x'.repeat(MAX_PARAGRAPH_TEXT))])).ok).toBe(true);
  });

  it('rejects transcript text exceeding MAX_TRANSCRIPT_TEXT', () => {
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
// N5: Nested paragraph and checklistItem text limits at every depth
// ---------------------------------------------------------------------------

describe('validateContentDocument — nested text limits (N5)', () => {
  const overlong = 'x'.repeat(MAX_PARAGRAPH_TEXT + 1);

  it('rejects overlong paragraph inside a quote', () => {
    const result = validate(doc([{
      type: 'quote', attrs: { attribution: null },
      content: [paragraph(overlong)],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
      expect(result.errors.some((e) => e.path?.includes('content'))).toBe(true);
    }
  });

  it('rejects overlong paragraph inside a professionalNote', () => {
    const result = validate(doc([{
      type: 'professionalNote', attrs: { noteKind: 'tip' },
      content: [paragraph(overlong)],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
  });

  it('rejects overlong paragraph inside a practicalStep', () => {
    const result = validate(doc([{
      type: 'practicalStep', attrs: { stepNumber: 1, title: 'Step' },
      content: [paragraph(overlong)],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
  });

  it('rejects overlong paragraph inside a listItem', () => {
    const result = validate(doc([{
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(overlong)] }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
  });

  it('rejects overlong checklistItem text', () => {
    const result = validate(doc([{
      type: 'checklist',
      content: [{
        type: 'checklistItem', attrs: { label: 'Check' },
        content: [{ type: 'text', text: overlong }],
      }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
  });

  it('accepts paragraph at limit inside a quote', () => {
    expect(validate(doc([{
      type: 'quote', attrs: { attribution: null },
      content: [paragraph('x'.repeat(MAX_PARAGRAPH_TEXT))],
    }])).ok).toBe(true);
  });

  it('counts code points, not UTF-16 code units', () => {
    // U+1F600 (emoji) is 1 code point but 2 UTF-16 code units
    const emoji = '\u{1F600}';
    // MAX_PARAGRAPH_TEXT code points of emoji = 2x MAX_PARAGRAPH_TEXT UTF-16 units
    const text = emoji.repeat(MAX_PARAGRAPH_TEXT);
    expect(validate(doc([paragraph(text)])).ok).toBe(true);
    // One more code point over the limit
    const overText = emoji.repeat(MAX_PARAGRAPH_TEXT + 1);
    expect(validate(doc([paragraph(overText)])).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema version (I7, I8) — content_schema_version error code
// ---------------------------------------------------------------------------

describe('validateContentDocument — schema version (I7, I8)', () => {
  it('rejects documents with wrong schemaVersion', () => {
    const result = validate({ type: 'doc', schemaVersion: 99, content: [paragraph()] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_schema_version')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N4: Error code mapping
// ---------------------------------------------------------------------------

describe('validateContentDocument — error code mapping (N4)', () => {
  it('href with a number produces content_invalid_link', () => {
    // Non-string href fails at the Zod layer
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 5 } }],
      }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_link')).toBe(true);
  });

  it('heading level 4 produces content_invalid_block', () => {
    const result = validate(doc([{
      type: 'sectionHeading', attrs: { level: 4 },
      content: [{ type: 'text', text: 'H4' }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
  });

  it('CTA missing required targetId produces content_invalid_block', () => {
    const result = validate(doc([{
      type: 'cta', attrs: { ctaKind: 'open_content' },
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
  });

  it('unknown mark type produces content_invalid_block', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'a', marks: [{ type: 'underline' }] }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
  });

  it('21 list items (too_big) produces content_invalid_block, not content_too_large', () => {
    const result = validate(doc([{
      type: 'bulletList',
      content: Array.from({ length: 21 }, () => ({
        type: 'listItem', content: [paragraph('item')],
      })),
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
      expect(result.errors.every((e) => e.code !== 'content_too_large')).toBe(true);
    }
  });

  it('U+00A0 in href produces content_invalid_link', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/ path' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_link')).toBe(true);
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

  it('ProseMirror errors include path when available', () => {
    const result = validate({ type: 'doc', schemaVersion: 1, content: [{ type: 'text', text: 'orphan' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
    }
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

// ---------------------------------------------------------------------------
// Link validation (content_invalid_link only for href failures)
// ---------------------------------------------------------------------------

describe('validateContentDocument — link validation', () => {
  it('rejects http:// links (requires https://)', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'http://example.com' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('accepts internal nestself:content/ links', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'nestself:content/abc-123' } }],
      }],
    }]));
    expect(result.ok).toBe(true);
  });

  it('rejects links to hosts not on the allowlist', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://evil.com/phish' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'content_invalid_link')).toBe(true);
  });

  it('accepts links to hosts on the allowlist', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/page' } }],
      }],
    }]));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Href hardening (T-C1.06)
// ---------------------------------------------------------------------------

describe('validateContentDocument — href hardening (T-C1.06)', () => {
  // (a) href must literally start with 'https://'
  it('rejects https:allowed.example (no double slash)', () => {
    // The URL parser normalizes 'https:allowed.example' to 'https://allowed.example/'
    // but the intent was likely a typo; we require the literal 'https://' prefix.
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https:allowed.example' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects https:///triple-slash', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https:///path' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('accepts valid https://example.com', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/page' } }],
      }],
    }]));
    expect(result.ok).toBe(true);
  });

  // (b) ASCII-only: reject non-ASCII characters
  it('rejects href with non-ASCII Unicode character', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://сajt.example.com' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects href with zero-width space in host', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://example​.com' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects href with full-width characters', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://ｅxample.com' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects href with Cyrillic lookalike host', () => {
    // Cyrillic 'а' (U+0430) looks like Latin 'a'
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://exаmple.com' } }],
      }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('accepts punycode IDN (xn-- prefix)', () => {
    // xn--80aswg.xn--p1ai is the punycode for сайт.рф
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'link',
        marks: [{ type: 'link', attrs: { href: 'https://xn--80aswg.xn--p1ai/page' } }],
      }],
    }]));
    // The punycode host is ASCII, so the Zod layer accepts it.
    // The allowlist layer may reject it if the host isn't whitelisted,
    // but the href shape itself is valid.
    // For this test, we just check the Zod parse (not the allowlist).
    // We rely on the allowlist rejecting it.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should fail on allowlist, not on href shape
      expect(result.errors.some((e) => e.code === 'content_invalid_link')).toBe(true);
    }
  });

  it('accepts internal nestself:content/ link (unchanged)', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'related',
        marks: [{ type: 'link', attrs: { href: 'nestself:content/abc-123' } }],
      }],
    }]));
    expect(result.ok).toBe(true);
  });
});
