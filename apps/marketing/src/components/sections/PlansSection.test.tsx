import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { PlansSection } from './PlansSection';

const baseProps = {
  tiers: [
    {
      name: 'Essential',
      audience: 'Small teams',
      includes: ['Psychological support', 'Legal guidance'],
      cta: { label: 'Get started', href: '/contact' },
    },
    {
      name: 'Professional',
      audience: 'Growing companies',
      includes: ['Everything in Essential', 'Financial planning'],
      cta: { label: 'Contact us', href: '/contact' },
    },
  ],
  note: 'Contact us for pricing tailored to your organisation.',
};

describe('PlansSection', () => {
  it('renders tier names as h3 headings', () => {
    render(<PlansSection {...baseProps} />);
    const h3s = screen.getAllByRole('heading', { level: 3 });
    expect(h3s).toHaveLength(2);
    expect(h3s[0]).toHaveTextContent('Essential');
    expect(h3s[1]).toHaveTextContent('Professional');
  });

  it('renders CTA links for each tier', () => {
    render(<PlansSection {...baseProps} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Get started');
  });

  it('renders the note text', () => {
    render(<PlansSection {...baseProps} />);
    expect(
      screen.getByText('Contact us for pricing tailored to your organisation.'),
    ).toBeInTheDocument();
  });

  it('renders tiers as a list', () => {
    render(<PlansSection {...baseProps} />);
    const lists = screen.getAllByRole('list');
    // The outer tier list plus inner includes lists
    expect(lists.length).toBeGreaterThanOrEqual(1);
    // The outer list has tier items
    const outerList = lists[0]!;
    expect(outerList.children).toHaveLength(2);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <PlansSection {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
