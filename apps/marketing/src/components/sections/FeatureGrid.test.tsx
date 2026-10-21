import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { FeatureGrid } from './FeatureGrid';

const baseProps = {
  id: 'features',
  title: 'Features',
  columns: 3 as const,
  items: [
    { icon: 'heart' as const, title: 'Psychological', body: 'Talk to a psychologist.' },
    { icon: 'scales' as const, title: 'Legal', body: 'Get legal guidance.' },
    { icon: 'wallet' as const, title: 'Financial', body: 'Plan your finances.' },
  ],
};

describe('FeatureGrid', () => {
  it('renders an h2 with the title', () => {
    render(<FeatureGrid {...baseProps} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Features');
  });

  it('renders each item as an h3', () => {
    render(<FeatureGrid {...baseProps} />);
    const h3s = screen.getAllByRole('heading', { level: 3 });
    expect(h3s).toHaveLength(3);
    expect(h3s[0]).toHaveTextContent('Psychological');
  });

  it('renders items in a list', () => {
    render(<FeatureGrid {...baseProps} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders item links when href is provided', () => {
    const items = [
      { icon: 'heart' as const, title: 'Linked', body: 'Body text.', href: '/linked' },
    ];
    render(<FeatureGrid {...baseProps} items={items} />);
    expect(screen.getByRole('link', { name: 'Linked' })).toHaveAttribute('href', '/linked');
  });

  it('renders eyebrow and lead', () => {
    render(<FeatureGrid {...baseProps} eyebrow="Services" lead="Lead text." />);
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('Lead text.')).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(
      <FeatureGrid {...baseProps} className="custom" />,
    );
    expect(container.firstElementChild).toHaveClass('custom');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <FeatureGrid {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
