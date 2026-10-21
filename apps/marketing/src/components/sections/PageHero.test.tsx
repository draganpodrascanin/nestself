import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { PageHero } from './PageHero';

const baseProps = {
  title: 'Test Title',
  lead: 'Test lead paragraph.',
  primaryCta: { label: 'Get started', href: '/start' },
  variant: 'split' as const,
};

describe('PageHero', () => {
  it('renders the h1 with the title', () => {
    render(<PageHero {...baseProps} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Test Title');
  });

  it('renders the only h1 on the page', () => {
    const { container } = render(<PageHero {...baseProps} />);
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
  });

  it('renders eyebrow when provided', () => {
    render(<PageHero {...baseProps} eyebrow="Category" />);
    expect(screen.getByText('Category')).toBeInTheDocument();
  });

  it('renders primary CTA as a link', () => {
    render(<PageHero {...baseProps} />);
    const link = screen.getByRole('link', { name: 'Get started' });
    expect(link).toHaveAttribute('href', '/start');
  });

  it('renders secondary CTA when provided', () => {
    render(
      <PageHero
        {...baseProps}
        secondaryCta={{ label: 'Learn more', href: '/learn' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Learn more' });
    expect(link).toHaveAttribute('href', '/learn');
  });

  it('renders as a landmark section', () => {
    render(<PageHero {...baseProps} />);
    const section = screen.getByRole('region', { name: 'Test Title' });
    expect(section).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(<PageHero {...baseProps} className="my-custom" />);
    expect(container.firstElementChild).toHaveClass('my-custom');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <PageHero {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
