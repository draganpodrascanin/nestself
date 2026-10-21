import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { ToolCard } from './ToolCard';

const baseProps = {
  href: '/tools/test',
  title: 'Test Tool',
  description: 'Tool description.',
  kindLabel: 'Guide',
  cover: { key: 'tools-notebook' as const, alt: 'Open notebook' },
};

describe('ToolCard', () => {
  it('renders the title as a link inside an h3', () => {
    render(<ToolCard {...baseProps} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Test Tool');
    const link = screen.getByRole('link', { name: 'Test Tool' });
    expect(link).toHaveAttribute('href', '/tools/test');
  });

  it('renders as an article element', () => {
    render(<ToolCard {...baseProps} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('renders the kind label', () => {
    render(<ToolCard {...baseProps} />);
    expect(screen.getByText('Guide')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <ToolCard {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
