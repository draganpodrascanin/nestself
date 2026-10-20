import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageNotice } from './CoverageNotice';
import { expectNoA11yViolations } from '../../../test/axe';

describe('CoverageNotice', () => {
  it('renders the children text', () => {
    render(<CoverageNotice>Know your coverage before you confirm.</CoverageNotice>);
    expect(screen.getByText('Know your coverage before you confirm.')).toBeInTheDocument();
  });

  it('renders the ShieldCheck icon as decorative', () => {
    const { container } = render(<CoverageNotice>Check coverage</CoverageNotice>);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<CoverageNotice>Know your coverage.</CoverageNotice>);
    await expectNoA11yViolations(container);
  });
});
