import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { TrustStrip } from './TrustStrip';

const baseProps = {
  items: [
    { icon: 'shield-check' as const, label: 'Confidential' },
    { icon: 'lock-key' as const, label: 'Encrypted' },
    { icon: 'check-circle' as const, label: 'Licensed' },
    { icon: 'hand-heart' as const, label: 'Supportive' },
  ],
};

describe('TrustStrip', () => {
  it('renders items in a list of four', () => {
    render(<TrustStrip {...baseProps} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders labels', () => {
    render(<TrustStrip {...baseProps} />);
    expect(screen.getByText('Confidential')).toBeInTheDocument();
    expect(screen.getByText('Encrypted')).toBeInTheDocument();
    expect(screen.getByText('Licensed')).toBeInTheDocument();
    expect(screen.getByText('Supportive')).toBeInTheDocument();
  });

  it('renders with an ariaLabel prop as a labelled region', () => {
    render(<TrustStrip {...baseProps} ariaLabel="Trust facts" />);
    expect(screen.getByRole('region', { name: 'Trust facts' })).toBeInTheDocument();
  });

  it('renders as a border-y band', () => {
    const { container } = render(<TrustStrip {...baseProps} />);
    const section = container.querySelector('section');
    expect(section).toBeInTheDocument();
    expect(section!.className).toContain('border-y');
  });

  it('renders as a plain section without ariaLabel', () => {
    const { container } = render(<TrustStrip {...baseProps} />);
    expect(container.querySelector('section')).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(<TrustStrip {...baseProps} className="custom" />);
    expect(container.firstElementChild).toHaveClass('custom');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <TrustStrip {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
