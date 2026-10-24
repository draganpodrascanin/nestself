/**
 * Tests for transliterateText() and transliterateDocument().
 *
 * Covers: exception list, Serbian digraphs (lj, nj, dz), every block
 * type proving ids/hrefs stay untouched.
 */
import { describe, expect, it } from 'vitest';

import type { ContentDocument } from './document.ts';
import { transliterateDocument, transliterateText } from './transliterate.ts';

// ---------------------------------------------------------------------------
// transliterateText — digraphs and exceptions
// ---------------------------------------------------------------------------

describe('transliterateText', () => {
  it('transliterates basic Latin to Cyrillic', () => {
    expect(transliterateText('abc')).toBe('абц');
  });

  it('transliterates digraph "lj" to "љ"', () => {
    expect(transliterateText('Ljubljana')).toBe('Љубљана');
  });

  it('transliterates digraph "nj" to "њ"', () => {
    expect(transliterateText('Njegoš')).toBe('Његош');
  });

  it('transliterates digraph "dž" to "џ"', () => {
    expect(transliterateText('džem')).toBe('џем');
  });

  it('transliterates "Dž" at word start', () => {
    expect(transliterateText('Džep')).toBe('Џеп');
  });

  it('preserves protected term NestSelf', () => {
    const result = transliterateText('Koristi NestSelf platformu');
    expect(result).toBe('Користи NestSelf платформу');
  });

  it('preserves protected term Pexels', () => {
    expect(transliterateText('sa Pexels sajta')).toContain('Pexels');
  });

  it('preserves protected term Europe/Belgrade', () => {
    expect(transliterateText('Europe/Belgrade')).toBe('Europe/Belgrade');
  });

  it('preserves {{placeholders}}', () => {
    expect(transliterateText('Zdravo, {{name}}!')).toBe('Здраво, {{name}}!');
  });

  it('preserves URLs', () => {
    expect(transliterateText('Poseti https://example.com/strana')).toContain(
      'https://example.com/strana',
    );
  });

  it('applies word override "injekcija"', () => {
    expect(transliterateText('injekcija')).toBe('инјекција');
  });

  it('applies word override "konjunktura"', () => {
    expect(transliterateText('konjunktura')).toBe('конјунктура');
  });

  it('applies word override "nadživeti"', () => {
    expect(transliterateText('nadživeti')).toBe('надживети');
  });

  it('handles mixed digraphs and single letters', () => {
    expect(transliterateText('Ljubljana i Njegoš')).toBe('Љубљана и Његош');
  });

  it('preserves numbers and punctuation', () => {
    expect(transliterateText('100% uspeh!')).toBe('100% успех!');
  });
});

// ---------------------------------------------------------------------------
// transliterateDocument — ids, hrefs, marks untouched
// ---------------------------------------------------------------------------

describe('transliterateDocument', () => {
  function makeDoc(content: unknown[]): ContentDocument {
    return {
      type: 'doc',
      schemaVersion: 1,
      content,
    } as ContentDocument;
  }

  it('preserves schemaVersion and type', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'paragraph', content: [{ type: 'text', text: 'tekst' }] }]),
      'sr-Cyrl',
    );
    expect(result.type).toBe('doc');
    expect(result.schemaVersion).toBe(1);
  });

  it('transliterates text nodes', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'paragraph', content: [{ type: 'text', text: 'tekst' }] }]),
      'sr-Cyrl',
    );
    const para = result.content[0] as Record<string, unknown>;
    const textNodes = para.content as Array<{ text: string }>;
    expect(textNodes[0]!.text).toBe('текст');
  });

  it('preserves link mark hrefs', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'link tekst',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/path' } }],
            },
          ],
        },
      ]),
      'sr-Cyrl',
    );
    const para = result.content[0] as Record<string, unknown>;
    const textNodes = para.content as Array<{ text: string; marks: Array<{ type: string; attrs: { href: string } }> }>;
    // Text is transliterated
    expect(textNodes[0]!.text).toBe('линк текст');
    // Href is unchanged
    expect(textNodes[0]!.marks[0]!.attrs.href).toBe('https://example.com/path');
    // Mark type is unchanged
    expect(textNodes[0]!.marks[0]!.type).toBe('link');
  });

  it('preserves bold and italic mark types', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
      ]),
      'sr-Cyrl',
    );
    const para = result.content[0] as Record<string, unknown>;
    const textNodes = para.content as Array<{ marks: Array<{ type: string }> }>;
    expect(textNodes[0]!.marks[0]!.type).toBe('bold');
    expect(textNodes[1]!.marks[0]!.type).toBe('italic');
  });

  it('preserves image mediaAssetId and transliterates alt/caption', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'image',
          attrs: { mediaAssetId: 'asset-123', alt: 'Slika', caption: 'Opis slike' },
        },
      ]),
      'sr-Cyrl',
    );
    const img = result.content[0] as Record<string, unknown>;
    const attrs = img.attrs as Record<string, unknown>;
    expect(attrs.mediaAssetId).toBe('asset-123');
    expect(attrs.alt).toBe('Слика');
    expect(attrs.caption).toBe('Опис слике');
  });

  it('preserves approvedMedia mediaAssetId and kind, transliterates caption', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'approvedMedia',
          attrs: { mediaAssetId: 'media-1', kind: 'audio', caption: 'Zvuk' },
        },
        {
          type: 'transcript',
          attrs: { mediaAssetId: 'media-1' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'transkript tekst' }] }],
        },
      ]),
      'sr-Cyrl',
    );
    const media = result.content[0] as Record<string, unknown>;
    const mediaAttrs = media.attrs as Record<string, unknown>;
    expect(mediaAttrs.mediaAssetId).toBe('media-1');
    expect(mediaAttrs.kind).toBe('audio');
    expect(mediaAttrs.caption).toBe('Звук');

    // Transcript mediaAssetId untouched
    const transcript = result.content[1] as Record<string, unknown>;
    const transcriptAttrs = transcript.attrs as Record<string, unknown>;
    expect(transcriptAttrs.mediaAssetId).toBe('media-1');
    // Transcript text is transliterated
    const tContent = transcript.content as Array<Record<string, unknown>>;
    const tText = (tContent[0]!.content as Array<{ text: string }>)[0]!;
    expect(tText.text).toBe('транскрипт текст');
  });

  it('preserves relatedResource contentResourceId', () => {
    const result = transliterateDocument(
      makeDoc([
        { type: 'relatedResource', attrs: { contentResourceId: 'res-abc' } },
      ]),
      'sr-Cyrl',
    );
    const node = result.content[0] as Record<string, unknown>;
    const attrs = node.attrs as Record<string, unknown>;
    expect(attrs.contentResourceId).toBe('res-abc');
  });

  it('preserves CTA ctaKind and targetId, transliterates label', () => {
    const result = transliterateDocument(
      makeDoc([
        { type: 'cta', attrs: { ctaKind: 'suggest_topic', targetId: 'target-1', label: 'Predloži temu' } },
      ]),
      'sr-Cyrl',
    );
    const node = result.content[0] as Record<string, unknown>;
    const attrs = node.attrs as Record<string, unknown>;
    expect(attrs.ctaKind).toBe('suggest_topic');
    expect(attrs.targetId).toBe('target-1');
    expect(attrs.label).toBe('Предложи тему');
  });

  it('transliterates quote attribution', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'quote',
          attrs: { attribution: 'Autor' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'citat' }] }],
        },
      ]),
      'sr-Cyrl',
    );
    const node = result.content[0] as Record<string, unknown>;
    const attrs = node.attrs as Record<string, unknown>;
    expect(attrs.attribution).toBe('Аутор');
  });

  it('transliterates practicalStep title', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'practicalStep',
          attrs: { stepNumber: 1, title: 'Korak jedan' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'opis' }] }],
        },
      ]),
      'sr-Cyrl',
    );
    const node = result.content[0] as Record<string, unknown>;
    const attrs = node.attrs as Record<string, unknown>;
    expect(attrs.stepNumber).toBe(1); // number unchanged
    expect(attrs.title).toBe('Корак један');
  });

  it('transliterates checklistItem label', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'checklist',
          content: [
            { type: 'checklistItem', attrs: { label: 'Proveri' } },
          ],
        },
      ]),
      'sr-Cyrl',
    );
    const checklist = result.content[0] as Record<string, unknown>;
    const items = checklist.content as Array<Record<string, unknown>>;
    const attrs = items[0]!.attrs as Record<string, unknown>;
    expect(attrs.label).toBe('Провери');
  });

  it('preserves sectionHeading level', () => {
    const result = transliterateDocument(
      makeDoc([
        { type: 'sectionHeading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Naslov' }] },
      ]),
      'sr-Cyrl',
    );
    const node = result.content[0] as Record<string, unknown>;
    const attrs = node.attrs as Record<string, unknown>;
    expect(attrs.level).toBe(3);
    // Text content transliterated
    const textNodes = node.content as Array<{ text: string }>;
    expect(textNodes[0]!.text).toBe('Наслов');
  });

  it('preserves hardBreak type inside a paragraph', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'tekst' },
            { type: 'hardBreak' },
            { type: 'text', text: 'drugi' },
          ],
        },
      ]),
      'sr-Cyrl',
    );
    const para = result.content[0] as Record<string, unknown>;
    const inlineNodes = para.content as Array<Record<string, unknown>>;
    // hardBreak preserved
    expect(inlineNodes[1]!.type).toBe('hardBreak');
    // Text around it transliterated
    expect((inlineNodes[0] as { text: string }).text).toBe('текст');
    expect((inlineNodes[2] as { text: string }).text).toBe('други');
  });

  it('preserves professionalNote noteKind', () => {
    const result = transliterateDocument(
      makeDoc([
        {
          type: 'professionalNote',
          attrs: { noteKind: 'disclaimer' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'napomena' }] }],
        },
      ]),
      'sr-Cyrl',
    );
    const node = result.content[0] as Record<string, unknown>;
    const attrs = node.attrs as Record<string, unknown>;
    expect(attrs.noteKind).toBe('disclaimer');
  });
});
