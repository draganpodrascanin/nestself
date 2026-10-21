import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { CtaBand } from './CtaBand';

const baseProps = {
  id: 'cta-band',
  title: 'Ready to start?',
  primary: { label: 'Request a demo', href: '/contact' },
};

describe('CtaBand', () => {
  it('renders an h2 with the title', () => {
    render(<CtaBand {...baseProps} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Ready to start?');
  });

  it('renders primary CTA link', () => {
    render(<CtaBand {...baseProps} />);
    const link = screen.getByRole('link', { name: 'Request a demo' });
    expect(link).toHaveAttribute('href', '/contact');
  });

  it('renders secondary CTA when provided', () => {
    render(
      <CtaBand {...baseProps} secondary={{ label: 'Learn more', href: '/about' }} />,
    );
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/about');
  });

  it('renders body text when provided', () => {
    render(<CtaBand {...baseProps} body="Supporting body text." />);
    expect(screen.getByText('Supporting body text.')).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(<CtaBand {...baseProps} className="extra" />);
    expect(container.firstElementChild).toHaveClass('extra');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <CtaBand {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
