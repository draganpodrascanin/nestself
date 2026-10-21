import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { SplitSection } from './SplitSection';

const baseProps = {
  id: 'split',
  title: 'Split Title',
  paragraphs: ['First paragraph.', 'Second paragraph.'],
  photo: { key: 'family-grass' as const, alt: 'A family on the grass' },
};

describe('SplitSection', () => {
  it('renders an h2 with the title', () => {
    render(<SplitSection {...baseProps} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Split Title');
  });

  it('renders all paragraphs', () => {
    render(<SplitSection {...baseProps} />);
    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
  });

  it('renders bullets when provided', () => {
    render(<SplitSection {...baseProps} bullets={['Bullet A', 'Bullet B']} />);
    expect(screen.getByText('Bullet A')).toBeInTheDocument();
    expect(screen.getByText('Bullet B')).toBeInTheDocument();
  });

  it('renders CTA link when provided', () => {
    render(
      <SplitSection {...baseProps} cta={{ label: 'Go', href: '/go' }} />,
    );
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/go');
  });

  it('renders as a landmark section', () => {
    render(<SplitSection {...baseProps} />);
    expect(screen.getByRole('region', { name: 'Split Title' })).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(
      <SplitSection {...baseProps} className="extra" />,
    );
    expect(container.firstElementChild).toHaveClass('extra');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <SplitSection {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
