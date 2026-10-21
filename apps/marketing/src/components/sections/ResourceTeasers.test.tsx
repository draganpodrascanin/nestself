import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { ResourceTeasers } from './ResourceTeasers';

const baseProps = {
  title: 'Resources',
  articles: [
    {
      href: '/articles/test',
      title: 'Test Article',
      description: 'Description.',
      topicLabel: 'Psychological',
      readingLabel: '5 min',
      cover: { key: 'article-morning' as const, alt: 'Morning' },
      dateLabel: '1 Oct 2026',
    },
  ],
  webinars: [],
  tools: [],
  moreHref: '/resources',
  moreLabel: 'See all resources',
};

describe('ResourceTeasers', () => {
  it('renders an h2 with the title', () => {
    render(<ResourceTeasers {...baseProps} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Resources');
  });

  it('renders the "more" link', () => {
    render(<ResourceTeasers {...baseProps} />);
    const link = screen.getByRole('link', { name: 'See all resources' });
    expect(link).toHaveAttribute('href', '/resources');
  });

  it('renders article cards', () => {
    render(<ResourceTeasers {...baseProps} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Test Article' })).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(
      <ResourceTeasers {...baseProps} className="custom" />,
    );
    expect(container.firstElementChild).toHaveClass('custom');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <ResourceTeasers {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
