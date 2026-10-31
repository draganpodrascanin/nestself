/**
 * Interactive tests for ContentRenderer (T-C1.06).
 *
 * These tests run under jsdom with @testing-library/react and exercise
 * behaviour that needs a live DOM:
 * - Checklist: toggling checkboxes, state reset on remount, and
 *   documentKey-based state reset (item 13)
 * - Audio/video: paused on mount, no autoplay attribute
 * - Transcript disclosure: opens/closes by keyboard (Enter/Space)
 * - Internal link resolver returning null renders plain text
 * - Adjacent link mark grouping (item 14)
 * - axe-core a11y check over the all-blocks document
 *
 * NOTE: polyfills (matchMedia, ResizeObserver, scrollIntoView) and
 * jest-dom matchers are loaded by setup.ts via vitest.config.ts.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import type { ContentDocument } from '../schema/document.ts';
import { expectNoA11yViolations } from '../test/axe.ts';

import { ContentRenderer } from './ContentRenderer.tsx';
import type { ContentRendererProps, MediaAssetMeta } from './types.ts';

// ---------------------------------------------------------------------------
// Setup — cleanup after each test (jest-dom matchers via setup.ts)
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(content: unknown[]): ContentDocument {
  return { type: 'doc', schemaVersion: 1, content } as ContentDocument;
}

function paragraph(text = 'Hello') {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** Default media record: one image, one audio, one video, one pdf. */
const defaultMedia: Record<string, MediaAssetMeta> = {
  'img-1': {
    kind: 'image',
    renditions: ['detail_webp', 'detail_jpeg'],
    width: 800,
    height: 450,
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

const defaultLabels: ContentRendererProps['labels'] = {
  transcript: 'Transcript',
  noteWarning: 'Warning',
  noteTip: 'Tip',
  noteDisclaimer: 'Disclaimer',
  noteDefault: 'Note',
  checklist: 'Checklist',
  opensInNewTab: '(opens in new tab)',
  downloadPdf: 'Download PDF',
  imageUnavailable: 'Image unavailable',
};

const mockMediaUrl: ContentRendererProps['mediaUrl'] = (id, rendition) =>
  `/media/${id}/${rendition}`;

const mockResolveCta: ContentRendererProps['resolveCta'] = (cta) => ({
  kind: 'link',
  href: `/action/${cta.ctaKind}`,
  label: cta.label ?? 'Take action',
});

const mockResolveRelated: ContentRendererProps['resolveRelated'] = (id) => ({
  title: `Resource ${id}`,
  href: `/content/${id}`,
  description: 'Related resource',
});

const mockResolveInternalLink: ContentRendererProps['resolveInternalLink'] = (id) => {
  if (id === 'unavailable-link') return null;
  return `/content/${id}`;
};

function renderDoc(document: ContentDocument, overrides?: Partial<ContentRendererProps>) {
  return render(
    <ContentRenderer
      document={document}
      media={defaultMedia}
      mediaUrl={mockMediaUrl}
      resolveCta={mockResolveCta}
      resolveRelated={mockResolveRelated}
      resolveInternalLink={mockResolveInternalLink}
      labels={defaultLabels}
      documentKey="test-doc-1"
      {...overrides}
    />,
  );
}

// ---------------------------------------------------------------------------
// Checklist: toggling and remount reset (item 13)
// ---------------------------------------------------------------------------

describe('Checklist — interactive', () => {
  const checklistDoc = doc([{
    type: 'checklist',
    content: [
      { type: 'checklistItem', attrs: { label: 'Task A' }, content: [{ type: 'text', text: 'Task A' }] },
      { type: 'checklistItem', attrs: { label: 'Task B' }, content: [{ type: 'text', text: 'Task B' }] },
    ],
  }]);

  it('toggles a checkbox on click', async () => {
    const user = userEvent.setup();
    renderDoc(checklistDoc);

    const checkboxA = screen.getByRole('checkbox', { name: 'Task A' });
    expect(checkboxA).not.toBeChecked();

    await user.click(checkboxA);
    expect(checkboxA).toBeChecked();

    await user.click(checkboxA);
    expect(checkboxA).not.toBeChecked();
  });

  it('resets checkbox state on remount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDoc(checklistDoc);

    const checkboxA = screen.getByRole('checkbox', { name: 'Task A' });
    await user.click(checkboxA);
    expect(checkboxA).toBeChecked();

    // Unmount and remount — state should reset
    unmount();
    renderDoc(checklistDoc);

    const checkboxAfter = screen.getByRole('checkbox', { name: 'Task A' });
    expect(checkboxAfter).not.toBeChecked();
  });

  it('resets state when documentKey changes (item 13)', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ContentRenderer
        document={checklistDoc}
        media={defaultMedia}
        mediaUrl={mockMediaUrl}
        resolveCta={mockResolveCta}
        resolveRelated={mockResolveRelated}
        resolveInternalLink={mockResolveInternalLink}
        labels={defaultLabels}
        documentKey="doc-A"
      />,
    );

    const checkboxA = screen.getByRole('checkbox', { name: 'Task A' });
    await user.click(checkboxA);
    expect(checkboxA).toBeChecked();

    // Re-render with different documentKey — state should reset
    rerender(
      <ContentRenderer
        document={checklistDoc}
        media={defaultMedia}
        mediaUrl={mockMediaUrl}
        resolveCta={mockResolveCta}
        resolveRelated={mockResolveRelated}
        resolveInternalLink={mockResolveInternalLink}
        labels={defaultLabels}
        documentKey="doc-B"
      />,
    );

    const checkboxAfter = screen.getByRole('checkbox', { name: 'Task A' });
    expect(checkboxAfter).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Audio/video: paused on mount, no autoplay
// ---------------------------------------------------------------------------

describe('Audio/video — interactive', () => {
  it('audio has no autoplay attribute and is paused on mount', () => {
    renderDoc(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [paragraph('Text')] },
    ]));

    const audio = document.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio!.hasAttribute('autoplay')).toBe(false);
    expect(audio!.paused).toBe(true);
  });

  it('video has no autoplay attribute and is paused on mount', () => {
    renderDoc(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'vid-1', kind: 'video' } },
      { type: 'transcript', attrs: { mediaAssetId: 'vid-1' }, content: [paragraph('Text')] },
    ]));

    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video!.hasAttribute('autoplay')).toBe(false);
    expect(video!.paused).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transcript disclosure: keyboard open/close
// ---------------------------------------------------------------------------

describe('Transcript disclosure — interactive', () => {
  const transcriptDoc = doc([
    { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
    {
      type: 'transcript',
      attrs: { mediaAssetId: 'aud-1' },
      content: [paragraph('Transcript content here')],
    },
  ]);

  it('opens and closes by keyboard (Enter)', async () => {
    const user = userEvent.setup();
    renderDoc(transcriptDoc);

    // The Accordion trigger button labelled "Transcript"
    const trigger = screen.getByRole('button', { name: 'Transcript' });
    expect(trigger).toBeInTheDocument();

    // Initially collapsed
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Open with Enter
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Close with Enter
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('transcript text is in the DOM even when collapsed (hiddenUntilFound)', () => {
    renderDoc(transcriptDoc);
    // The text should be findable in the DOM regardless of visibility
    expect(screen.getByText('Transcript content here')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Internal link resolver returning null → plain text
// ---------------------------------------------------------------------------

describe('Internal link — resolver null', () => {
  it('renders plain text when resolveInternalLink returns null', () => {
    renderDoc(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'dead link',
        marks: [{ type: 'link', attrs: { href: 'nestself:content/unavailable-link' } }],
      }],
    }]));

    // The text should be present
    expect(screen.getByText('dead link')).toBeInTheDocument();
    // But no <a> wrapping it
    const links = document.querySelectorAll('a');
    // Filter to only links that contain "dead link" text
    const deadLinks = Array.from(links).filter((a) =>
      a.textContent?.includes('dead link'),
    );
    expect(deadLinks).toHaveLength(0);
  });

  it('renders a link when resolveInternalLink returns a path', () => {
    renderDoc(doc([{
      type: 'paragraph',
      content: [{
        type: 'text', text: 'live link',
        marks: [{ type: 'link', attrs: { href: 'nestself:content/abc-123' } }],
      }],
    }]));

    const link = screen.getByRole('link', { name: 'live link' });
    expect(link).toHaveAttribute('href', '/content/abc-123');
  });
});

// ---------------------------------------------------------------------------
// Adjacent link mark grouping (item 14)
// ---------------------------------------------------------------------------

describe('Adjacent link marks — grouping', () => {
  it('groups adjacent text nodes with the same link into a single <a>', () => {
    renderDoc(doc([{
      type: 'paragraph',
      content: [
        {
          type: 'text', text: 'first ',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
        {
          type: 'text', text: 'second',
          marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    }]));

    // Should be a single link containing both text fragments
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toContain('first ');
    expect(links[0]!.textContent).toContain('second');
  });

  it('creates separate <a> elements for different link hrefs', () => {
    renderDoc(doc([{
      type: 'paragraph',
      content: [
        {
          type: 'text', text: 'link A',
          marks: [{ type: 'link', attrs: { href: 'https://a.example.com' } }],
        },
        {
          type: 'text', text: 'link B',
          marks: [{ type: 'link', attrs: { href: 'https://b.example.com' } }],
        },
      ],
    }]));

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('link A');
    expect(links[1]).toHaveTextContent('link B');
  });
});

// ---------------------------------------------------------------------------
// axe-core a11y check over the all-blocks document
// ---------------------------------------------------------------------------

describe('ContentRenderer — axe a11y', () => {
  it('passes axe-core checks for a document with every block type', async () => {
    const fullDoc = doc([
      { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      paragraph('Body text'),
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Bullet')] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('Ordered')] }] },
      { type: 'quote', attrs: { attribution: 'Author' }, content: [paragraph('Quote')] },
      { type: 'image', attrs: { mediaAssetId: 'img-1', alt: 'Photo', caption: 'Fig' } },
      { type: 'professionalNote', attrs: { noteKind: 'tip' }, content: [paragraph('Tip')] },
      { type: 'practicalStep', attrs: { stepNumber: 1, title: 'Step' }, content: [paragraph('Do')] },
      { type: 'checklist', content: [{ type: 'checklistItem', attrs: { label: 'Check' }, content: [{ type: 'text', text: 'Check' }] }] },
      { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio' } },
      { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [paragraph('Transcript')] },
      { type: 'relatedResource', attrs: { contentResourceId: 'res-1' } },
      { type: 'cta', attrs: { ctaKind: 'open_content', targetId: 'res-1', label: 'Read more' } },
    ]);

    const { container } = renderDoc(fullDoc);
    await expectNoA11yViolations(container);
  });
});
