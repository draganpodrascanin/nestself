import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { WebinarCard } from './WebinarCard';

const baseProps = {
  href: '/webinars/test',
  title: 'Test Webinar',
  description: 'Webinar description.',
  dateLabel: '20 Nov 2026',
  durationLabel: '45 min',
  formatLabel: 'Live',
  languagesLabel: 'EN, SR',
  cover: { key: 'webinar-speaker' as const, alt: 'Speaker presenting' },
};

describe('WebinarCard', () => {
  it('renders the title as a link inside an h3', () => {
    render(<WebinarCard {...baseProps} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Test Webinar');
    const link = screen.getByRole('link', { name: 'Test Webinar' });
    expect(link).toHaveAttribute('href', '/webinars/test');
  });

  it('renders as an article element', () => {
    render(<WebinarCard {...baseProps} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('renders metadata labels', () => {
    render(<WebinarCard {...baseProps} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(screen.getByText('EN, SR')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <WebinarCard {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
