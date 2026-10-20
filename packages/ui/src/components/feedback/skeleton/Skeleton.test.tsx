import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from './Skeleton';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Skeleton', () => {
  it('renders aria-hidden bars', () => {
    const { container } = render(<Skeleton label="Loading content" />);
    const wrapper = container.firstElementChild!;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a visually hidden label', () => {
    render(<Skeleton label="Loading appointments" />);
    expect(screen.getByText('Loading appointments')).toBeInTheDocument();
  });

  it('renders the specified number of lines', () => {
    const { container } = render(<Skeleton lines={5} label="Loading" />);
    // Lines are span elements inside the wrapper (excluding the sr-only span)
    const bars = container.querySelectorAll('span:not(.sr-only)');
    // The first child is the sr-only label; then 5 bars
    expect(bars.length).toBe(5);
  });

  it('defaults to 3 lines', () => {
    const { container } = render(<Skeleton label="Loading" />);
    const bars = container.querySelectorAll('span:not(.sr-only)');
    expect(bars.length).toBe(3);
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Skeleton label="Loading data" />);
    await expectNoA11yViolations(container);
  });
});
