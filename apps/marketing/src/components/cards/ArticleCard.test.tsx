import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { ArticleCard } from './ArticleCard';

const baseProps = {
  href: '/articles/test',
  title: 'Test Article',
  description: 'Article description.',
  topicLabel: 'Psychological',
  readingLabel: '5 min read',
  cover: { key: 'article-morning' as const, alt: 'Morning reading' },
  dateLabel: '15 Oct 2026',
};

describe('ArticleCard', () => {
  it('renders the title as a link inside an h3', () => {
    render(<ArticleCard {...baseProps} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Test Article');
    const link = screen.getByRole('link', { name: 'Test Article' });
    expect(link).toHaveAttribute('href', '/articles/test');
  });

  it('renders as an article element', () => {
    render(<ArticleCard {...baseProps} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('renders metadata labels', () => {
    render(<ArticleCard {...baseProps} />);
    expect(screen.getByText('Psychological')).toBeInTheDocument();
    expect(screen.getByText('5 min read')).toBeInTheDocument();
    expect(screen.getByText('15 Oct 2026')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <ArticleCard {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
