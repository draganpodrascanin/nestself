import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';
import { expectNoA11yViolations } from '../../../test/axe';

describe('ProgressBar', () => {
  it('renders a progressbar with correct aria attributes', () => {
    render(<ProgressBar value={42} label="Upload progress" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders the visible label', () => {
    render(<ProgressBar value={60} label="Completion" />);
    expect(screen.getByText('Completion')).toBeInTheDocument();
  });

  it('shows value text when showValue is true', () => {
    render(<ProgressBar value={75} label="Progress" showValue />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('does not show value text when showValue is false', () => {
    render(<ProgressBar value={75} label="Progress" />);
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <ProgressBar value={50} label="Loading" showValue />,
    );
    await expectNoA11yViolations(container);
  });
});
