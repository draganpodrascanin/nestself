import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SampleDataBanner } from './SampleDataBanner';
import { expectNoA11yViolations } from '../../../test/axe';

describe('SampleDataBanner', () => {
  it('renders the message', () => {
    render(<SampleDataBanner message="This is sample data for demonstration only." />);
    expect(screen.getByText('This is sample data for demonstration only.')).toBeInTheDocument();
  });

  it('has role="note"', () => {
    render(<SampleDataBanner message="Sample data" />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('renders the WarningCircle icon as decorative', () => {
    const { container } = render(<SampleDataBanner message="Sample" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<SampleDataBanner message="Sample data" />);
    await expectNoA11yViolations(container);
  });
});
