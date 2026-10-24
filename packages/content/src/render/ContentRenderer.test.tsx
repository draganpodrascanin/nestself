/**
 * Structural tests for ContentRenderer and block components (T-C1.06).
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
import type {
  ContentRendererProps,
  ContentRendererLabels,
  MediaAssetMeta,
} from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(content: unknown[]): ContentDocument {
  return { type: 'doc', schemaVersion: 1, content } as ContentDocument;
}

function paragraph(text = 'Hello') {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const mockLabels: ContentRendererLabels = {
  transcript: 'Transcript',
  noteWarning: 'Warning',
  noteTip: 'Tip',
  noteDisclaimer: 'Disclaimer',
  noteDefault: 'Note',
  checklist: 'Checklist',
  opensInNewTab: 'opens in a new tab',
  downloadPdf: 'Download PDF',
  imageUnavailable: 'Image unavailable',
};

const mockMedia: Record<string, MediaAssetMeta> = {
  'img-1': {
    kind: 'image',
    renditions: ['detail_webp', 'detail_jpeg', 'original'],
    width: 800,
    height: 600,
  },
  'aud-1': {
    kind: 'audio',
    renditions: ['audio'],
  },
  'vid-1': {
    kind: 'video',
    renditions: ['video', 'poster_webp'],
  },
  'pdf-1': {
    kind: 'pdf',
    renditions: ['pdf'],
  },
};

const mockMediaUrl: ContentRendererProps['mediaUrl'] = (id, rendition) =>
  `/media/${id}/${rendition}`;

const mockResolveCta: ContentRendererProps['resolveCta'] = (cta) => {
  if (cta.ctaKind === 'null_cta') return null;
  if (cta.ctaKind === 'suggest_topic') {
    return {
      kind: 'action',
      onActivate: () => {},
      label: cta.label ?? 'Suggest',
    };
  }
  return {
    kind: 'link',
    href: `/action/${cta.ctaKind}`,
    label: cta.label ?? 'Take action',
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
      media={mockMedia}
      mediaUrl={mockMediaUrl}
      resolveCta={mockResolveCta}
      resolveRelated={mockResolveRelated}
      resolveInternalLink={mockResolveInternalLink}
      labels={mockLabels}
      documentKey="test-doc-1"
      headingOffset={headingOffset}
    />,
  );
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

describe('ContentRenderer — block rendering', () => {
  it('wraps blocks in a div with role="article"', () => {
    const html = render(doc([paragraph('Hello')]));
    expect(html).toMatch(/^<div role="article">/);
  });

  it('renders a paragraph with text', () => {
    const html = render(doc([paragraph('Hello world')]));
    expect(html).toContain('<p');
    expect(html).toContain('Hello world');
  });

  it('renders sectionHeading level 2 as h2 with type-section-title', () => {
    const html = render(doc([
      { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
    ]));
    expect(html).toContain('<h2');
    expect(html).toContain('type-section-title');
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

  it('renders nothing for unknown block type (error boundary)', () => {
    const html = render(doc([{ type: 'script', content: [] }] as unknown[]));
    expect(html).toBe('<div role="article"></div>');
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

  it('renders italic mark as <em> with font-synthesis-style:none', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'italic text',
        marks: [{ type: 'italic' }],
      }],
    }]));
    expect(html).toContain('<em');
    expect(html).toContain('italic text');
    expect(html).toContain('font-synthesis-style:none');
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
    expect(html).toContain('<em');
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

  it('groups adjacent text nodes sharing the same link into one <a>', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [
        {
          type: 'text', text: 'click ',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
        {
          type: 'text', text: 'here',
          marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    }]));
    const anchorCount = (html.match(/<a /g) ?? []).length;
    expect(anchorCount).toBe(1);
    expect(html).toContain('click ');
    expect(html).toContain('<strong>here</strong>');
  });

  it('splits different link hrefs into separate <a> elements', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [
        {
          type: 'text', text: 'first',
          marks: [{ type: 'link', attrs: { href: 'https://one.example' } }],
        },
        {
          type: 'text', text: 'second',
          marks: [{ type: 'link', attrs: { href: 'https://two.example' } }],
        },
      ],
    }]));
    const anchorCount = (html.match(/<a /g) ?? []).length;
    expect(anchorCount).toBe(2);
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
    expect(html).toContain('type-metadata');
    expect(html).toContain('not-italic');
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
// Image — <picture> with webp/jpeg fallback (item 1)
// ---------------------------------------------------------------------------

describe('ContentRenderer — image', () => {
  it('renders <picture> with <source> webp and <img> fallback', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: 'A photo', caption: null },
    }]));
    expect(html).toContain('<picture>');
    expect(html).toContain('<source');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain('srcSet="/media/img-1/detail_webp"');
    expect(html).toContain('<img');
    expect(html).toContain('src="/media/img-1/detail_jpeg"');
    expect(html).toContain('alt="A photo"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
  });

  it('renders <figcaption> when caption is provided', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: 'Photo', caption: 'Figure 1' },
    }]));
    expect(html).toContain('<figcaption');
    expect(html).toContain('Figure 1');
    expect(html).toContain('type-metadata');
  });

  it('alt attribute is always present (even empty)', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: '' },
    }]));
    expect(html).toContain('alt=""');
  });

  it('renders nothing when asset is missing from media record', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'missing-asset', alt: 'Gone', caption: null },
    }]));
    expect(html).not.toContain('<picture');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Gone');
  });

  it('renders nothing for invalid asset id', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: '../../etc/passwd', alt: 'Hack' },
    }]));
    expect(html).not.toContain('<picture');
    expect(html).not.toContain('Hack');
  });

  it('renders object-position from focal point', () => {
    const mediaWithFocal = {
      ...mockMedia,
      'img-focal': {
        kind: 'image' as const,
        renditions: ['detail_webp' as const, 'detail_jpeg' as const],
        width: 1200,
        height: 800,
        focalPoint: { x: 0.3, y: 0.7 },
      },
    };
    const html = renderToStaticMarkup(
      <ContentRenderer
        document={doc([{
          type: 'image',
          attrs: { mediaAssetId: 'img-focal', alt: 'Focal' },
        }])}
        media={mediaWithFocal}
        mediaUrl={mockMediaUrl}
        resolveCta={mockResolveCta}
        resolveRelated={mockResolveRelated}
        resolveInternalLink={mockResolveInternalLink}
        labels={mockLabels}
        documentKey="test-doc-1"
      />,
    );
    expect(html).toContain('object-position:30.0% 70.0%');
  });
});

// ---------------------------------------------------------------------------
// Professional note — aria-labelledby (item 10, item 20)
// ---------------------------------------------------------------------------

describe('ContentRenderer — professionalNote', () => {
  it('renders as <aside> with role="note" and aria-labelledby', () => {
    const html = render(doc([{
      type: 'professionalNote',
      attrs: { noteKind: 'tip' },
      content: [paragraph('A tip for you')],
    }]));
    expect(html).toContain('<aside');
    expect(html).toContain('role="note"');
    expect(html).toContain('aria-labelledby=');
    // The label text comes from the labels prop
    expect(html).toContain('>Tip</p>');
    expect(html).toContain('A tip for you');
    expect(html).toContain('bg-success-surface');
  });

  it('renders warning note with correct token and label', () => {
    const html = render(doc([{
      type: 'professionalNote',
      attrs: { noteKind: 'warning' },
      content: [paragraph('Be careful')],
    }]));
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('>Warning</p>');
    expect(html).toContain('bg-warning-surface');
  });

  it('renders disclaimer note with correct token', () => {
    const html = render(doc([{
      type: 'professionalNote',
      attrs: { noteKind: 'disclaimer' },
      content: [paragraph('Legal note')],
    }]));
    expect(html).toContain('>Disclaimer</p>');
    expect(html).toContain('bg-raised');
  });

  it('links aside aria-labelledby to the label paragraph id', () => {
    const html = render(doc([{
      type: 'professionalNote',
      attrs: { noteKind: 'tip' },
      content: [paragraph('Content')],
    }]));
    const labelledbyMatch = html.match(/aria-labelledby="([^"]+)"/);
    expect(labelledbyMatch).not.toBeNull();
    const labelId = labelledbyMatch![1];
    expect(html).toContain(`id="${labelId}"`);
  });
});

// ---------------------------------------------------------------------------
// Practical step — aria-labelledby (item 20)
// ---------------------------------------------------------------------------

describe('ContentRenderer — practicalStep', () => {
  it('renders as <section> with step number and aria-labelledby', () => {
    const html = render(doc([{
      type: 'practicalStep',
      attrs: { stepNumber: 1, title: 'Breathe deeply' },
      content: [paragraph('Take a deep breath')],
    }]));
    expect(html).toContain('<section');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('>1</span>');
    expect(html).toContain('min-w-7');
    expect(html).toContain('min-h-7');
    expect(html).toContain('Breathe deeply');
    expect(html).toContain('Take a deep breath');
  });

  it('links section aria-labelledby to the title paragraph id', () => {
    const html = render(doc([{
      type: 'practicalStep',
      attrs: { stepNumber: 2, title: 'Step title' },
      content: [paragraph('Body')],
    }]));
    const labelledbyMatch = html.match(/aria-labelledby="([^"]+)"/);
    expect(labelledbyMatch).not.toBeNull();
    const labelId = labelledbyMatch![1];
    expect(html).toContain(`id="${labelId}"`);
    expect(html).toContain('Step title');
  });
});

// ---------------------------------------------------------------------------
// Checklist — @nestself/ui Checkbox (item 3/13)
// ---------------------------------------------------------------------------

describe('ContentRenderer — checklist', () => {
  it('renders as <ul> with aria-label from labels prop', () => {
    const html = render(doc([{
      type: 'checklist',
      content: [
        { type: 'checklistItem', attrs: { label: 'Task 1' } },
        { type: 'checklistItem', attrs: { label: 'Task 2' } },
      ],
    }]));
    expect(html).toContain('<ul');
    expect(html).toContain('role="list"');
    expect(html).toContain('aria-label="Checklist"');
    expect(html).toContain('Task 1');
    expect(html).toContain('Task 2');
  });

  it('renders checklist items with visible label text (not aria-label override)', () => {
    const html = render(doc([{
      type: 'checklist',
      content: [
        { type: 'checklistItem', attrs: { label: 'Review this' } },
      ],
    }]));
    // Label text appears as visible content, not as aria-label on the checkbox
    expect(html).toContain('Review this');
    // The label text is inside a <span> inside Checkbox's <label>, not as aria-label
    expect(html).not.toMatch(/aria-label="Review this"/);
  });
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
    ]));
    expect(html).toContain('<audio');
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="metadata"');
    expect(html).not.toContain('autoplay');
    expect(html).toContain('src="/media/aud-1/audio"');
  });

  it('renders video as <video> with controls and no autoplay', () => {
    const html = render(doc([
      {
        type: 'approvedMedia',
        attrs: { mediaAssetId: 'vid-1', kind: 'video', caption: null },
      },
    ]));
    expect(html).toContain('<video');
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="metadata"');
    expect(html).not.toContain('autoplay');
    expect(html).toContain('src="/media/vid-1/video"');
    expect(html).toContain('poster="/media/vid-1/poster_webp"');
  });

  it('renders PDF as a download link', () => {
    const html = render(doc([{
      type: 'approvedMedia',
      attrs: { mediaAssetId: 'pdf-1', kind: 'pdf', caption: 'My Document' },
    }]));
    expect(html).toContain('<a');
    expect(html).toContain('download=""');
    expect(html).toContain('My Document');
    expect(html).toContain('href="/media/pdf-1/pdf"');
  });

  it('renders nothing when media asset is missing from record', () => {
    const html = render(doc([{
      type: 'approvedMedia',
      attrs: { mediaAssetId: 'nonexistent', kind: 'audio' },
    }]));
    expect(html).not.toContain('<audio');
    expect(html).not.toContain('<video');
  });

  it('renders nothing for invalid asset id', () => {
    const html = render(doc([{
      type: 'approvedMedia',
      attrs: { mediaAssetId: '../../../etc/passwd', kind: 'audio' },
    }]));
    expect(html).not.toContain('<audio');
  });
});

// ---------------------------------------------------------------------------
// Transcript — Accordion with hiddenUntilFound (item 15)
// ---------------------------------------------------------------------------

describe('ContentRenderer — transcript', () => {
  it('renders transcript with the label from the labels prop', () => {
    const html = render(doc([
      {
        type: 'transcript',
        attrs: { mediaAssetId: 'aud-1' },
        content: [paragraph('This is the transcript')],
      },
    ]));
    expect(html).toContain('Transcript');
    expect(html).toContain('This is the transcript');
  });

  it('transcript heading level follows headingOffset', () => {
    const html = render(
      doc([
        {
          type: 'transcript',
          attrs: { mediaAssetId: 'aud-1' },
          content: [paragraph('Text')],
        },
      ]),
      1,
    );
    // Base level is 3, offset 1 → h4
    expect(html).toContain('<h4');
  });
});

// ---------------------------------------------------------------------------
// Related resource
// ---------------------------------------------------------------------------

describe('ContentRenderer — relatedResource', () => {
  it('renders a card with title, href, and description', () => {
    const html = render(doc([{
      type: 'relatedResource',
      attrs: { contentResourceId: 'res-1' },
    }]));
    expect(html).toContain('Resource res-1');
    expect(html).toContain('href="/content/res-1"');
    expect(html).toContain('A related resource');
    expect(html).toContain('bg-raised');
  });

  it('renders nothing when the resource is unavailable', () => {
    const html = render(doc([{
      type: 'relatedResource',
      attrs: { contentResourceId: 'unavailable' },
    }]));
    expect(html).not.toContain('unavailable');
    expect(html).not.toContain('Resource unavailable');
  });

  it('renders nothing for invalid contentResourceId', () => {
    const html = render(doc([{
      type: 'relatedResource',
      attrs: { contentResourceId: '../../etc/passwd' },
    }]));
    expect(html).not.toContain('passwd');
  });
});

// ---------------------------------------------------------------------------
// CTA — discriminated union (item 16)
// ---------------------------------------------------------------------------

describe('ContentRenderer — cta', () => {
  it('renders a CTA link (kind: link) as an anchor', () => {
    const html = render(doc([{
      type: 'cta',
      attrs: { ctaKind: 'open_content', targetId: 'res-1', label: 'Read more' },
    }]));
    expect(html).toContain('<a');
    expect(html).toContain('Read more');
    expect(html).toContain('href="/action/open_content"');
  });

  it('renders a CTA action (kind: action) as a button', () => {
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
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('renders <img onerror> in alt attribute as escaped text', () => {
    const html = render(doc([{
      type: 'image',
      attrs: { mediaAssetId: 'img-1', alt: '<img onerror=alert(1)>' },
    }]));
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
    expect(html).not.toContain('<img onerror');
  });

  it('does not render a link with javascript: href', () => {
    const html = render(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'click',
        marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
      }],
    }]));
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

  it('does not contain dangerouslySetInnerHTML or innerHTML in the source', async () => {
    const { execSync } = await import('node:child_process');
    const renderDir = new URL('.', import.meta.url).pathname;
    const result = execSync(
      `grep -rn 'dangerouslySetInnerHTML\\|innerHTML' "${renderDir}" --include="*.tsx" --include="*.ts" || true`,
      { encoding: 'utf8' },
    );
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

    expect(html).toContain('href="/content/abc-123"');
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

    expect(html).toContain('<h2');
    expect(html).toContain('<p');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em');
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<figure');
    expect(html).toContain('<picture>');
    expect(html).toContain('<img');
    expect(html).toContain('<aside');
    expect(html).toContain('<section');
    expect(html).toContain('Checklist');
    expect(html).toContain('<audio');
    expect(html).toContain('Transcript');
    expect(html).toContain('Resource res-1');
    expect(html).toContain('Read more');
    expect(html).toContain('role="article"');
  });
});
