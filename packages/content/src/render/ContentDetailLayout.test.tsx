import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentDetailLayout } from './ContentDetailLayout.tsx';
import type { ContentRendererLabels } from './types.ts';

const LABELS: ContentRendererLabels = {
  transcript: 'Show transcript',
  noteWarning: 'Warning',
  noteTip: 'Tip',
  noteDisclaimer: 'Disclaimer',
  noteDefault: 'Note',
  checklist: 'Checklist',
  opensInNewTab: '(opens in a new tab)',
  downloadPdf: 'Download PDF',
  imageUnavailable: 'Image unavailable',
};

const MINIMAL_DOC = {
  type: 'doc' as const,
  schemaVersion: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
  ],
};

const BASE_PROPS = {
  document: MINIMAL_DOC,
  media: {},
  mediaUrl: () => '',
  resolveCta: () => null,
  resolveRelated: () => null,
  resolveInternalLink: () => null,
  labels: LABELS,
  documentKey: 'test-key',
};

describe('ContentDetailLayout', () => {
  it('renders the title as h1', () => {
    render(<ContentDetailLayout {...BASE_PROPS} title="Test Title" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Test Title');
  });

  it('renders outcome when provided', () => {
    render(
      <ContentDetailLayout {...BASE_PROPS} title="T" outcome="Learn something" />,
    );
    expect(screen.getByText('Learn something')).toBeInTheDocument();
  });

  it('omits outcome when null', () => {
    render(
      <ContentDetailLayout {...BASE_PROPS} title="T" outcome={null} />,
    );
    expect(screen.queryByText('Learn something')).not.toBeInTheDocument();
  });

  it('formats duration from seconds', () => {
    render(
      <ContentDetailLayout {...BASE_PROPS} title="T" durationSeconds={300} />,
    );
    expect(screen.getByText('5 min')).toBeInTheDocument();
  });

  it('prefers durationLabel over durationSeconds', () => {
    render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        durationSeconds={300}
        durationLabel="About 5 minutes"
      />,
    );
    expect(screen.getByText('About 5 minutes')).toBeInTheDocument();
    expect(screen.queryByText('5 min')).not.toBeInTheDocument();
  });

  it('renders author and date', () => {
    render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        author="Katarina"
        dateLabel="2026-10-01"
      />,
    );
    expect(screen.getByText('Katarina')).toBeInTheDocument();
    expect(screen.getByText('2026-10-01')).toBeInTheDocument();
  });

  it('renders the document body', () => {
    render(<ContentDetailLayout {...BASE_PROPS} title="T" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders headerExtra when provided', () => {
    render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        headerExtra={<div data-testid="extra">Extra content</div>}
      />,
    );
    expect(screen.getByTestId('extra')).toBeInTheDocument();
  });

  // -- Slot tests (backward compatible) --

  it('renders beforeTitle slot above the title', () => {
    render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        beforeTitle={<nav data-testid="back-link">Back</nav>}
      />,
    );
    const nav = screen.getByTestId('back-link');
    const h1 = screen.getByRole('heading', { level: 1 });
    // beforeTitle appears before the title in the DOM
    expect(nav.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders summary after the title', () => {
    render(
      <ContentDetailLayout {...BASE_PROPS} title="T" summary="A brief summary" />,
    );
    expect(screen.getByText('A brief summary')).toBeInTheDocument();
  });

  it('renders outcome as section with heading when outcomeLabel is set', () => {
    render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        outcome="Learn something"
        outcomeLabel="What you'll learn"
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: "What you'll learn" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Learn something')).toBeInTheDocument();
  });

  it('renders metaExtra in the metadata row', () => {
    render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        metaExtra={<span data-testid="badge">Category</span>}
      />,
    );
    expect(screen.getByTestId('badge')).toBeInTheDocument();
  });

  it('renders afterBody after the content body', () => {
    render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        afterBody={<div data-testid="save-btn">Save</div>}
      />,
    );
    const body = screen.getByText('Hello world');
    const save = screen.getByTestId('save-btn');
    expect(body.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('applies custom className to the article wrapper', () => {
    const { container } = render(
      <ContentDetailLayout
        {...BASE_PROPS}
        title="T"
        className="custom-class"
      />,
    );
    expect(container.querySelector('article')?.className).toBe('custom-class');
  });

  it('uses default className when none is provided', () => {
    const { container } = render(
      <ContentDetailLayout {...BASE_PROPS} title="T" />,
    );
    expect(container.querySelector('article')?.className).toContain('max-w-[720px]');
  });
});
