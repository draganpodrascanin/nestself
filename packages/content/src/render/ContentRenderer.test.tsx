/**
 * Tests for ContentRenderer and block components (T-C1.06).
 *
 * Uses renderToStaticMarkup from react-dom/server for structural tests
 * (element types, attributes, marks, XSS safety). Interactive tests
 * (checklist, media, transcript keyboard) are in the companion
 * ContentRenderer.interactive.test.tsx which runs under jsdom with
 * @testing-library/react.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../schema/document.ts';
import { transliterateDocument } from '../schema/transliterate.ts';

import { ContentRenderer } from './ContentRenderer.tsx';
import type { ContentRendererProps } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(content: unknown[]): ContentDocument {
  return { type: 'doc', schemaVersion: 1, content } as ContentDocument;
}

function paragraph(text = 'Hello') {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const mockMediaUrl: ContentRendererProps['mediaUrl'] = (id, rendition) =>
  `/media/${id}/${rendition}`;

const mockResolveCta: ContentRendererProps['resolveCta'] = (cta) => {
  if (cta.ctaKind === 'null_cta') return null;
  return {
    href: `/action/${cta.ctaKind}`,
    label: cta.label ?? 'Take action',
    isLink: cta.ctaKind === 'open_content',
  };
};

const mockResolveRelated: ContentRendererProps['resolveRelated'] = (id) => {
  if (id === 'unavailable') return null;
  return {
    title: `Resource ${id}`,
    href: `/content/${id}`,
    description: 'A related resource',
  };
};

const mockResolveInternalLink: ContentRendererProps['resolveInternalLink'] = (id) => {
  if (id === 'unavailable-link') return null;
  return `/content/${id}`;
};

function render(document: ContentDocument, headingOffset = 0): string {
  return renderToStaticMarkup(
    <ContentRenderer
      document={document}
      mediaUrl={mockMediaUrl}
      resolveCta={mockResolveCta}
      resolveRelated={mockResolveRelated}
      resolveInternalLink={mockResolveInternalLink}
      headingOffset={headingOffset}
    />,
  );
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

describe('ContentRenderer — block rendering', () => {
  it('renders a paragraph with text', () => {
    const html = render(doc([paragraph('Hello world')]));
    expect(html).toContain('<p');
    expect(html).toContain('Hello world');
  });

  it('renders sectionHeading level 2 as h2', () => {
    const html = render(doc([
      { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
    ]));
    expect(html).toContain('<h2');
    expect(html).toContain('Title');
  });

  it('renders sectionHeading level 3 as h3', () => {
    const html = render(doc([
      { type: 'sectionHeading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sub' }] },
    ]));
    expect(html).toContain('<h3');
    expect(html).toContain('Sub');
  });

  it('offsets heading levels with headingOffset', () => {
    const html = render(
      doc([
        { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      ]),
      1,
    );
    expect(html).toContain('<h3');
    expect(html).not.toContain('<h2');
  });

  it('offsets level 3 with headingOffset=1 to h4', () => {
    const html = render(
      doc([
        { type: 'sectionHeading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sub' }] },
      ]),
      1,
    );
    expect(html).toContain('<h4');
  });

  it('clamps heading level at h6', () => {
    const html = render(
      doc([
        { type: 'sectionHeading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Deep' }] },
      ]),
      4,
    );
    // 3 + 4 = 7, clamped to 6
    expect(html).toContain('<h6');
  });

  it('renders hardBreak as <br>', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Line one' },
        { type: 'hardBreak' },
        { type: 'text', text: 'Line two' },
      ],
    }]));
    expect(html).toContain('<br');
    expect(html).toContain('Line one');
    expect(html).toContain('Line two');
  });
});

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

describe('ContentRenderer — marks', () => {
  it('renders bold mark as <strong>', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'bold text',
        marks: [{ type: 'bold' }],
      }],
    }]));
    expect(html).toContain('<strong>bold text</strong>');
  });

  it('renders italic mark as <em>', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'italic text',
        marks: [{ type: 'italic' }],
      }],
    }]));
    expect(html).toContain('<em>italic text</em>');
  });

  it('renders link mark as <a> with href', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'click here',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/page' } }],
      }],
    }]));
    expect(html).toContain('<a');
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('click here');
    // External link: target="_blank" and rel
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders internal link without target="_blank"', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'related',
        marks: [{ type: 'link', attrs: { href: 'nestself:content/abc-123' } }],
      }],
    }]));
    expect(html).toContain('href="/content/abc-123"');
    expect(html).not.toContain('target="_blank"');
  });

  it('renders combined bold + italic marks', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'both',
        marks: [{ type: 'bold' }, { type: 'italic' }],
      }],
    }]));
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('both');
  });

  it('renders external link with accessible new-tab hint', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'external',
        marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
      }],
    }]));
    expect(html).toContain('sr-only');
    expect(html).toContain('opens in a new tab');
  });
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

describe('ContentRenderer — lists', () => {
  it('renders bulletList as <ul> with <li> items', () => {
    const html = render(doc([{
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph('Item 1')] },
        { type: 'listItem', content: [paragraph('Item 2')] },
      ],
    }]));
    expect(html).toContain('<ul');
    expect(html).toContain('<li>');
    expect(html).toContain('Item 1');
    expect(html).toContain('Item 2');
  });

  it('renders orderedList as <ol> with start attribute', () => {
    const html = render(doc([{
      type: 'orderedList',
      attrs: { start: 3 },
      content: [
        { type: 'listItem', content: [paragraph('Third')] },
      ],
    }]));
    expect(html).toContain('<ol');
    expect(html).toContain('start="3"');
    expect(html).toContain('Third');
  });

  it('renders nested lists (two levels)', () => {
    const html = render(doc([{
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [
          paragraph('Outer'),
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [paragraph('Inner')] }],
          },
        ],
      }],
    }]));
    // Two <ul> tags
    const ulCount = (html.match(/<ul/g) ?? []).length;
    expect(ulCount).toBe(2);
    expect(html).toContain('Outer');
    expect(html).toContain('Inner');
  });
});

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

describe('ContentRenderer — quote', () => {
  it('renders as <blockquote> with attribution in <footer>', () => {
    const html = render(doc([{
      type: 'quote',
      attrs: { attribution: 'Author Name' },
      content: [paragraph('A wise quote')],
    }]));
    expect(html).toContain('<blockquote');
    expect(html).toContain('A wise quote');
    expect(html).toContain('<footer');
    expect(html).toContain('Author Name');
  });

  it('renders without attribution when null', () => {
    const html = render(doc([{
      type: 'quote',
      attrs: { attribution: null },
      content: [paragraph('Anonymous quote')],
    }]));
    expect(html).toContain('<blockquote');
    expect(html).not.toContain('<footer');
  });
});

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

describe('ContentRenderer — image', () => {
  it('renders <img> with alt text and resolved src', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: 'A photo', caption: null },
    }]));
    expect(html).toContain('<img');
    expect(html).toContain('alt="A photo"');
    expect(html).toContain('src="/media/img-1/detail"');
    expect(html).toContain('loading="lazy"');
  });

  it('renders <figcaption> when caption is provided', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: 'Photo', caption: 'Figure 1' },
    }]));
    expect(html).toContain('<figcaption');
    expect(html).toContain('Figure 1');
  });

  it('alt attribute is always present', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: '' },
    }]));
    expect(html).toContain('alt=""');
  });
});

// ---------------------------------------------------------------------------
// Professional note
// ---------------------------------------------------------------------------

describe('ContentRenderer — professionalNote', () => {
  it('renders as <aside> with role="note"', () => {
    const html = render(doc([{
      type: 'professionalNote',
      attrs: { noteKind: 'tip' },
      content: [paragraph('A tip for you')],
    }]));
    expect(html).toContain('<aside');
    expect(html).toContain('role="note"');
    expect(html).toContain('aria-label="Tip"');
    expect(html).toContain('A tip for you');
  });

  it('renders warning note kind', () => {
    const html = render(doc([{
      type: 'professionalNote',
      attrs: { noteKind: 'warning' },
      content: [paragraph('Be careful')],
    }]));
    expect(html).toContain('aria-label="Warning"');
  });
});

// ---------------------------------------------------------------------------
// Practical step
// ---------------------------------------------------------------------------

describe('ContentRenderer — practicalStep', () => {
  it('renders as <section> with step number and aria-label', () => {
    const html = render(doc([{
      type: 'practicalStep',
      attrs: { stepNumber: 1, title: 'Breathe deeply' },
      content: [paragraph('Take a deep breath')],
    }]));
    expect(html).toContain('<section');
    expect(html).toContain('aria-label="Breathe deeply"');
    expect(html).toContain('>1</span>');
    expect(html).toContain('Breathe deeply');
    expect(html).toContain('Take a deep breath');
  });
});

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

describe('ContentRenderer — checklist', () => {
  it('renders as <ul> with checkboxes', () => {
    const html = render(doc([{
      type: 'checklist',
      content: [
        { type: 'checklistItem', attrs: { label: 'Task 1' } },
        { type: 'checklistItem', attrs: { label: 'Task 2' } },
      ],
    }]));
    expect(html).toContain('<ul');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-label="Task 1"');
    expect(html).toContain('aria-label="Task 2"');
  });

  // Note: Interactive checklist state tests (toggle + remount reset)
  // require @testing-library/react + jsdom, which are not available
  // in this package. See "Missing dev dependencies" note at top.
});

// ---------------------------------------------------------------------------
// Approved media
// ---------------------------------------------------------------------------

describe('ContentRenderer — approvedMedia', () => {
  it('renders audio as <audio> with controls and no autoplay', () => {
    const html = render(doc([
      {
        type: 'approvedMedia',
        attrs: { mediaAssetId: 'aud-1', kind: 'audio', caption: null },
      },
      {
        type: 'transcript',
        attrs: { mediaAssetId: 'aud-1' },
        content: [paragraph('Transcript text')],
      },
    ]));
    expect(html).toContain('<audio');
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="metadata"');
    expect(html).not.toContain('autoplay');
    expect(html).toContain('src="/media/aud-1/detail"');
  });

  it('renders video as <video> with controls and no autoplay', () => {
    const html = render(doc([
      {
        type: 'approvedMedia',
        attrs: { mediaAssetId: 'vid-1', kind: 'video', caption: null },
      },
      {
        type: 'transcript',
        attrs: { mediaAssetId: 'vid-1' },
        content: [paragraph('Transcript text')],
      },
    ]));
    expect(html).toContain('<video');
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="metadata"');
    expect(html).not.toContain('autoplay');
  });

  it('renders PDF as a download link with file-type hint', () => {
    const html = render(doc([{
      type: 'approvedMedia',
      attrs: { mediaAssetId: 'pdf-1', kind: 'pdf', caption: 'My Document' },
    }]));
    expect(html).toContain('<a');
    expect(html).toContain('download=""');
    expect(html).toContain('My Document');
    expect(html).toContain('PDF');
  });
});

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

describe('ContentRenderer — transcript', () => {
  it('renders transcript text and the "Transcript" trigger label', () => {
    const html = render(doc([
      {
        type: 'approvedMedia',
        attrs: { mediaAssetId: 'aud-1', kind: 'audio' },
      },
      {
        type: 'transcript',
        attrs: { mediaAssetId: 'aud-1' },
        content: [paragraph('This is the transcript')],
      },
    ]));
    // The Accordion renders a button trigger with the title
    expect(html).toContain('Transcript');
    expect(html).toContain('This is the transcript');
  });
});

// ---------------------------------------------------------------------------
// Related resource
// ---------------------------------------------------------------------------

describe('ContentRenderer — relatedResource', () => {
  it('renders a card when the resource is available', () => {
    const html = render(doc([{
      type: 'relatedResource',
      attrs: { contentResourceId: 'res-1' },
    }]));
    expect(html).toContain('Resource res-1');
    expect(html).toContain('href="/content/res-1"');
    expect(html).toContain('A related resource');
  });

  it('renders nothing when the resource is unavailable', () => {
    const html = render(doc([{
      type: 'relatedResource',
      attrs: { contentResourceId: 'unavailable' },
    }]));
    // The component should render nothing (empty in the output)
    expect(html).not.toContain('unavailable');
    expect(html).not.toContain('Resource unavailable');
  });
});

// ---------------------------------------------------------------------------
// CTA
// ---------------------------------------------------------------------------

describe('ContentRenderer — cta', () => {
  it('renders a CTA link when resolved', () => {
    const html = render(doc([{
      type: 'cta',
      attrs: { ctaKind: 'open_content', targetId: 'res-1', label: 'Read more' },
    }]));
    expect(html).toContain('<a');
    expect(html).toContain('Read more');
    expect(html).toContain('href="/action/open_content"');
  });

  it('renders a CTA button when not a link', () => {
    const html = render(doc([{
      type: 'cta',
      attrs: { ctaKind: 'suggest_topic', label: 'Suggest' },
    }]));
    expect(html).toContain('<button');
    expect(html).toContain('Suggest');
  });

  it('renders nothing when CTA resolver returns null', () => {
    const html = render(doc([{
      type: 'cta',
      attrs: { ctaKind: 'null_cta' },
    }]));
    // Should not render any interactive element
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<button');
  });
});

// ---------------------------------------------------------------------------
// XSS and injection at the render layer (6.9)
// ---------------------------------------------------------------------------

describe('ContentRenderer — XSS (6.9)', () => {
  it('renders <script> text as escaped literal text', () => {
    const html = render(doc([paragraph('<script>alert(1)</script>')]));
    // React escapes < and > in text children
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('renders <img onerror> in alt attribute as escaped text', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: '<img onerror=alert(1)>' },
    }]));
    // React escapes the < and > in the alt attribute value, preventing
    // the injected <img> from being parsed as a new element by the browser.
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
    // The payload's '<' is entity-encoded: the browser will never parse
    // a second <img> element from this output.
    expect(html).not.toContain('<img onerror');
  });

  it('does not render a link with javascript: href', () => {
    // A document that somehow bypasses validation and reaches the renderer
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'click',
        marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
      }],
    }]));
    // The renderer renders plain text (no <a> tag)
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('click');
  });

  it('does not render a link with data: href', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'click',
        marks: [{ type: 'link', attrs: { href: 'data:text/html,<script>alert(1)</script>' } }],
      }],
    }]));
    expect(html).not.toContain('href="data:');
    expect(html).toContain('click');
  });

  it('renders nothing for unknown node type', () => {
    const html = render(doc([{ type: 'script', content: [] }] as unknown[]));
    // Only the wrapper div
    expect(html).toBe('<div data-testid="content-renderer"></div>');
  });

  it('does not contain dangerouslySetInnerHTML or innerHTML in the source', async () => {
    // This is a grep/static analysis test — we read the source files
    const { execSync } = await import('node:child_process');
    const renderDir = new URL('.', import.meta.url).pathname;
    const result = execSync(
      `grep -rn 'dangerouslySetInnerHTML\\|innerHTML' "${renderDir}" --include="*.tsx" --include="*.ts" || true`,
      { encoding: 'utf8' },
    );
    // Filter out test files and comments
    const lines = result
      .split('\n')
      .filter((line) => line.trim() !== '')
      .filter((line) => !line.includes('.test.'))
      .filter((line) => !line.includes('// '))
      .filter((line) => !line.includes('* '));
    expect(lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Transliteration round-trip (C-28)
// ---------------------------------------------------------------------------

describe('ContentRenderer — transliterateDocument round-trip', () => {
  it('renders Cyrillic text from transliterated document', () => {
    const latin = doc([
      paragraph('Dobar dan'),
      {
        type: 'sectionHeading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Naslov' }],
      },
      {
        type: 'professionalNote',
        attrs: { noteKind: 'tip' },
        content: [paragraph('Savet za vas')],
      },
    ]);

    const cyrillic = transliterateDocument(latin, 'sr-Cyrl');
    const html = render(cyrillic);

    // The transliterated text should contain Cyrillic characters
    // and no Latin Serbian letters (outside the exception list).
    // The exception list in i18n allows certain Latin characters
    // that are the same in both scripts.
    expect(html).toContain('Добар дан');
    expect(html).toContain('Наслов');
    expect(html).toContain('Савет за вас');
  });

  it('preserves ids and hrefs in transliterated document', () => {
    const latin = doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'Link',
        marks: [{ type: 'link', attrs: { href: 'nestself:content/abc-123' } }],
      }],
    }]);

    const cyrillic = transliterateDocument(latin, 'sr-Cyrl');
    const html = render(cyrillic);

    // href should be preserved as ASCII, not transliterated
    expect(html).toContain('href="/content/abc-123"');
    // Text should be transliterated
    expect(html).toContain('Линк');
  });
});

// ---------------------------------------------------------------------------
// Full document with every block type
// ---------------------------------------------------------------------------

describe('ContentRenderer — full document', () => {
  it('renders a document with every block type', () => {
    const fullDoc = doc([
      { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Introduction' }] },
      paragraph('Welcome to this article.'),
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'This has ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' and a ' },
          {
            type: 'text', text: 'link',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
          { type: 'text', text: '.' },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Bullet')] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('Ordered')] }] },
      { type: 'quote', attrs: { attribution: 'Author' }, content: [paragraph('Quote text')] },
      { type: 'image', attrs: { mediaAssetId: 'img-1', alt: 'Photo', caption: 'Caption' } },
      { type: 'professionalNote', attrs: { noteKind: 'disclaimer' }, content: [paragraph('Note')] },
      { type: 'practicalStep', attrs: { stepNumber: 1, title: 'Step' }, content: [paragraph('Do it')] },
      { type: 'checklist', content: [{ type: 'checklistItem', attrs: { label: 'Check' } }] },
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [paragraph('Transcript')] },
      { type: 'relatedResource', attrs: { contentResourceId: 'res-1' } },
      { type: 'cta', attrs: { ctaKind: 'open_content', targetId: 'res-1', label: 'Read more' } },
    ]);

    const html = render(fullDoc);

    // Every block type should be present
    expect(html).toContain('<h2');
    expect(html).toContain('<p');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<figure');
    expect(html).toContain('<img');
    expect(html).toContain('<aside');
    expect(html).toContain('<section');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<audio');
    expect(html).toContain('Transcript');
    expect(html).toContain('Resource res-1');
    expect(html).toContain('Read more');
  });
});
