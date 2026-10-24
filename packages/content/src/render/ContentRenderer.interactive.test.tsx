// @vitest-environment jsdom
/**
 * Interactive tests for ContentRenderer (T-C1.06).
 *
 * These tests run under jsdom with @testing-library/react and exercise
 * behaviour that needs a live DOM:
 * - Checklist: toggling checkboxes and state reset on remount
 * - Audio/video: paused on mount, no autoplay attribute
 * - Transcript disclosure: opens/closes by keyboard (Enter/Space)
 * - Internal link resolver returning null renders plain text
 * - axe-core a11y check over the all-blocks document
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import type { ContentDocument } from '../schema/document.ts';
import { expectNoA11yViolations } from '../test/axe.ts';

import { ContentRenderer } from './ContentRenderer.tsx';
import type { ContentRendererProps } from './types.ts';

// ---------------------------------------------------------------------------
// Setup — cleanup after each test (jest-dom matchers loaded above)
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// Polyfills for jsdom
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
}

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

const mockResolveCta: ContentRendererProps['resolveCta'] = (cta) => ({
  href: `/action/${cta.ctaKind}`,
  label: cta.label ?? 'Take action',
  isLink: true,
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

function renderDoc(document: ContentDocument) {
  return render(
    <ContentRenderer
      document={document}
      mediaUrl={mockMediaUrl}
      resolveCta={mockResolveCta}
      resolveRelated={mockResolveRelated}
      resolveInternalLink={mockResolveInternalLink}
    />,
  );
}

// ---------------------------------------------------------------------------
// Checklist: toggling and remount reset
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

  it('transcript text is in the DOM even when collapsed', () => {
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
