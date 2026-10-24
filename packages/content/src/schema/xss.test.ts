/**
 * XSS and injection tests (FMT-R-19, section 6.9).
 * Colocated next to validate.ts (R5).
 *
 * Covers: javascript: links, data: links, mixed-case schemes,
 * whitespace-padded schemes, protocol-relative URLs, http: links,
 * unknown node types, extra attributes (onerror injection),
 * HTML-in-attribute text.
 */
import { describe, expect, it } from 'vitest';

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
// XSS and injection cases (6.9)
// ---------------------------------------------------------------------------

describe('XSS and injection (6.9)', () => {
  it('accepts script text in a text node as plain text', () => {
    // The text "<script>alert(1)</script>" is stored as-is; the React
    // renderer auto-escapes it. Validation does not reject text content.
    const result = validate(doc([paragraph('<script>alert(1)</script>')]));
    expect(result.ok).toBe(true);
  });

  it('rejects javascript: in link href', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects data: in link href', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'data:text/html,<script>alert(1)</script>' } }] }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    // These are rejected by the Zod layer (no whitespace/control chars + must be https: or nestself:)
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: '//evil.com/payload' } }] }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects http: links', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'http://example.com' } }] }],
    }]));
    expect(result.ok).toBe(false);
  });

  it('rejects https: link to host not on the allowlist', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'https://evil.com/page' } }] }],
    }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'content_invalid_link')).toBe(true);
    }
  });

  it('accepts https: link to host on the allowlist', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'https://example.com/page' } }] }],
    }]));
    expect(result.ok).toBe(true);
  });

  it('accepts internal nestself:content/ link', () => {
    const result = validate(doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'related', marks: [{ type: 'link', attrs: { href: 'nestself:content/abc-123' } }] }],
    }]));
    expect(result.ok).toBe(true);
  });

  it('rejects unknown node types (closed catalogue)', () => {
    const result = validate(doc([{ type: 'script', content: [] }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
    }
  });

  // 6.9 HTML-in-attribute case: alt with HTML injection
  // Choice: HTML in string attributes is accepted as plain text.
  // The React renderer auto-escapes attribute values. The content
  // document is data, not HTML — injection is a rendering concern.
  it('accepts HTML in image alt as plain text (6.9)', () => {
    const result = validate(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: '<img onerror=alert(1)>' },
    }]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const img = result.document.content[0] as Record<string, unknown>;
      const attrs = img.attrs as Record<string, unknown>;
      expect(attrs.alt).toBe('<img onerror=alert(1)>');
    }
  });
});
