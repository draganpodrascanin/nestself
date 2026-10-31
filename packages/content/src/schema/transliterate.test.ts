/**
 * Tests for transliterateText() and transliterateDocument().
 *
 * Covers: table-driven transliteration from the exception exports plus
 * uppercase digraphs LJ, NJ, DŽ, Lj, Nj, Dž (I16), document walk
 * preserving ids/hrefs/marks, mark arrays not shared with input (17),
 * all block types including checklistItem label, approvedMedia caption,
 * and transcript text (Minor).
 */
import { describe, expect, it } from 'vitest';

// Import exceptions from the canonical i18n export (Minor)
import { protectedTerms, wordOverrides } from '@nestself/i18n/transliterate';

import type { ContentDocument } from './document.ts';
import { transliterateDocument, transliterateText } from './transliterate.ts';

// ---------------------------------------------------------------------------
// Table-driven: protected terms from i18n export (Minor)
// ---------------------------------------------------------------------------

describe('transliterateText — protected terms (table-driven)', () => {
  for (const term of protectedTerms) {
    it(`preserves protected term "${term}"`, () => {
      const input = `pre ${term} post`;
      const result = transliterateText(input);
      expect(result).toContain(term);
    });
  }
});

// ---------------------------------------------------------------------------
// Table-driven: word overrides from i18n export (Minor)
// ---------------------------------------------------------------------------

describe('transliterateText — word overrides (table-driven)', () => {
  for (const [latin, cyrillic] of Object.entries(wordOverrides)) {
    it(`transliterates "${latin}" to "${cyrillic}"`, () => {
      expect(transliterateText(latin)).toBe(cyrillic);
    });
  }
});

// ---------------------------------------------------------------------------
// Digraphs: all case variants (I16)
// ---------------------------------------------------------------------------

describe('transliterateText — digraphs (all cases)', () => {
  const cases: Array<[string, string, string]> = [
    ['lowercase lj', 'ljubav', 'љубав'],
    ['titlecase Lj', 'Ljubljana', 'Љубљана'],
    ['uppercase LJ (in word)', 'LJUBAV', 'ЉУБАВ'],
    ['lowercase nj', 'njegov', 'његов'],
    ['titlecase Nj', 'Njegoš', 'Његош'],
    ['uppercase NJ (in word)', 'NJEGOV', 'ЊЕГОВ'],
    ['lowercase dž', 'džem', 'џем'],
    ['titlecase Dž', 'Džep', 'Џеп'],
    ['uppercase DŽ (in word)', 'DŽEP', 'ЏЕП'],
  ];

  for (const [desc, input, expected] of cases) {
    it(`transliterates ${desc}: "${input}" -> "${expected}"`, () => {
      expect(transliterateText(input)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// transliterateText — basic cases
// ---------------------------------------------------------------------------

describe('transliterateText', () => {
  it('transliterates basic Latin to Cyrillic', () => {
    expect(transliterateText('abc')).toBe('абц');
  });

  it('preserves {{placeholders}}', () => {
    expect(transliterateText('Zdravo, {{name}}!')).toBe('Здраво, {{name}}!');
  });

  it('preserves URLs', () => {
    expect(transliterateText('Poseti https://example.com/strana')).toContain('https://example.com/strana');
  });

  it('handles mixed digraphs and single letters', () => {
    expect(transliterateText('Ljubljana i Njegoš')).toBe('Љубљана и Његош');
  });

  it('preserves numbers and punctuation', () => {
    expect(transliterateText('100% uspeh!')).toBe('100% успех!');
  });
});

// ---------------------------------------------------------------------------
// transliterateDocument — every block type (Minor)
// ---------------------------------------------------------------------------

describe('transliterateDocument', () => {
  function makeDoc(content: unknown[]): ContentDocument {
    return { type: 'doc', schemaVersion: 1, content } as ContentDocument;
  }

  it('preserves schemaVersion and type', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'paragraph', content: [{ type: 'text', text: 'tekst' }] }]),
      'sr-Cyrl',
    );
    expect(result.type).toBe('doc');
    expect(result.schemaVersion).toBe(1);
  });

  it('transliterates text nodes in paragraphs', () => {
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
      makeDoc([{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'link tekst',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/path' } }],
        }],
      }]),
      'sr-Cyrl',
    );
    const para = result.content[0] as Record<string, unknown>;
    const nodes = para.content as Array<{ text: string; marks: Array<{ attrs: { href: string } }> }>;
    expect(nodes[0]!.text).toBe('линк текст');
    expect(nodes[0]!.marks[0]!.attrs.href).toBe('https://example.com/path');
  });

  it('preserves image mediaAssetId and transliterates alt/caption', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'image', attrs: { mediaAssetId: 'asset-123', alt: 'Slika', caption: 'Opis slike' } }]),
      'sr-Cyrl',
    );
    const attrs = (result.content[0] as Record<string, unknown>).attrs as Record<string, unknown>;
    expect(attrs.mediaAssetId).toBe('asset-123');
    expect(attrs.alt).toBe('Слика');
    expect(attrs.caption).toBe('Опис слике');
  });

  it('preserves CTA ctaKind and targetId, transliterates label', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'cta', attrs: { ctaKind: 'suggest_topic', targetId: 'target-1', label: 'Predloži temu' } }]),
      'sr-Cyrl',
    );
    const attrs = (result.content[0] as Record<string, unknown>).attrs as Record<string, unknown>;
    expect(attrs.ctaKind).toBe('suggest_topic');
    expect(attrs.targetId).toBe('target-1');
    expect(attrs.label).toBe('Предложи тему');
  });

  it('transliterates quote attribution', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'quote', attrs: { attribution: 'Autor' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'citat' }] }] }]),
      'sr-Cyrl',
    );
    expect(((result.content[0] as Record<string, unknown>).attrs as Record<string, unknown>).attribution).toBe('Аутор');
  });

  it('transliterates practicalStep title', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'practicalStep', attrs: { stepNumber: 1, title: 'Korak jedan' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'opis' }] }] }]),
      'sr-Cyrl',
    );
    const attrs = (result.content[0] as Record<string, unknown>).attrs as Record<string, unknown>;
    expect(attrs.stepNumber).toBe(1);
    expect(attrs.title).toBe('Корак један');
  });

  it('transliterates sectionHeading text', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Naslov' }] }]),
      'sr-Cyrl',
    );
    const heading = result.content[0] as Record<string, unknown>;
    const nodes = heading.content as Array<{ text: string }>;
    expect(nodes[0]!.text).toBe('Наслов');
  });

  it('transliterates checklistItem label', () => {
    const result = transliterateDocument(
      makeDoc([{
        type: 'checklist',
        content: [{ type: 'checklistItem', attrs: { label: 'Proveri tekst' } }],
      }]),
      'sr-Cyrl',
    );
    const checklist = result.content[0] as Record<string, unknown>;
    const items = checklist.content as Array<Record<string, unknown>>;
    expect((items[0]!.attrs as Record<string, unknown>).label).toBe('Провери текст');
  });

  it('transliterates approvedMedia caption', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'approvedMedia', attrs: { mediaAssetId: 'vid-1', kind: 'video', caption: 'Video opis' } }]),
      'sr-Cyrl',
    );
    const attrs = (result.content[0] as Record<string, unknown>).attrs as Record<string, unknown>;
    expect(attrs.mediaAssetId).toBe('vid-1');
    expect(attrs.kind).toBe('video');
    expect(attrs.caption).toBe('Видео опис');
  });

  it('transliterates transcript text content', () => {
    const result = transliterateDocument(
      makeDoc([{
        type: 'transcript', attrs: { mediaAssetId: 'aud-1' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'tekst transkripta' }] }],
      }]),
      'sr-Cyrl',
    );
    const transcript = result.content[0] as Record<string, unknown>;
    const paras = transcript.content as Array<Record<string, unknown>>;
    const texts = paras[0]!.content as Array<{ text: string }>;
    expect(texts[0]!.text).toBe('текст транскрипта');
  });

  it('transliterates bulletList/orderedList text', () => {
    const result = transliterateDocument(
      makeDoc([{
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'stavka' }] }] }],
      }]),
      'sr-Cyrl',
    );
    const list = result.content[0] as Record<string, unknown>;
    const items = list.content as Array<Record<string, unknown>>;
    const paras = items[0]!.content as Array<Record<string, unknown>>;
    const texts = paras[0]!.content as Array<{ text: string }>;
    expect(texts[0]!.text).toBe('ставка');
  });

  it('preserves relatedResource contentResourceId', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'relatedResource', attrs: { contentResourceId: 'res-123' } }]),
      'sr-Cyrl',
    );
    const attrs = (result.content[0] as Record<string, unknown>).attrs as Record<string, unknown>;
    expect(attrs.contentResourceId).toBe('res-123');
  });

  it('transliterates professionalNote text', () => {
    const result = transliterateDocument(
      makeDoc([{
        type: 'professionalNote', attrs: { noteKind: 'tip' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'savet' }] }],
      }]),
      'sr-Cyrl',
    );
    const note = result.content[0] as Record<string, unknown>;
    const paras = note.content as Array<Record<string, unknown>>;
    const texts = paras[0]!.content as Array<{ text: string }>;
    expect(texts[0]!.text).toBe('савет');
  });

  it('preserves hardBreak inside a paragraph', () => {
    const result = transliterateDocument(
      makeDoc([{ type: 'paragraph', content: [{ type: 'text', text: 'tekst' }, { type: 'hardBreak' }, { type: 'text', text: 'drugi' }] }]),
      'sr-Cyrl',
    );
    const para = result.content[0] as Record<string, unknown>;
    const nodes = para.content as Array<Record<string, unknown>>;
    expect(nodes[1]!.type).toBe('hardBreak');
    expect((nodes[0] as { text: string }).text).toBe('текст');
    expect((nodes[2] as { text: string }).text).toBe('други');
  });

  it('does not share mark arrays with input (17)', () => {
    const inputDoc = makeDoc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'test', marks: [{ type: 'bold' }] }],
    }]);
    const result = transliterateDocument(inputDoc, 'sr-Cyrl');
    const inputMarks = ((inputDoc.content[0] as Record<string, unknown>).content as Array<{ marks: unknown[] }>)[0]!.marks;
    const resultMarks = ((result.content[0] as Record<string, unknown>).content as Array<{ marks: unknown[] }>)[0]!.marks;
    expect(resultMarks).not.toBe(inputMarks);
    expect(resultMarks).toEqual(inputMarks);
  });
});
