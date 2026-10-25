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
});
