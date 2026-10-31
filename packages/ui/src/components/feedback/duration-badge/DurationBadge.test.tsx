import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DurationBadge } from './DurationBadge';
import { expectNoA11yViolations } from '../../../test/axe';

/** Default formatter for tests. */
const fmt = (s: number) => {
  const m = Math.round(s / 60);
  return m < 1 ? '<1 min' : `${m} min`;
};

describe('DurationBadge', () => {
  it('renders formatted duration from seconds via formatLabel', () => {
    render(<DurationBadge durationSeconds={300} formatLabel={fmt} />);
    expect(screen.getByText('5 min')).toBeInTheDocument();
  });

  it('renders sub-minute as <1 min via formatLabel', () => {
    render(<DurationBadge durationSeconds={20} formatLabel={fmt} />);
    expect(screen.getByText('<1 min')).toBeInTheDocument();
  });

  it('rounds to nearest minute', () => {
    render(<DurationBadge durationSeconds={150} formatLabel={fmt} />);
    // 2.5 min rounds to 3 min
    expect(screen.getByText('3 min')).toBeInTheDocument();
  });

  it('renders band label as fallback', () => {
    render(<DurationBadge bandLabel="Under 5 min" formatLabel={fmt} />);
    expect(screen.getByText('Under 5 min')).toBeInTheDocument();
  });

  it('prefers seconds over band label', () => {
    render(<DurationBadge durationSeconds={600} bandLabel="Under 5 min" formatLabel={fmt} />);
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.queryByText('Under 5 min')).not.toBeInTheDocument();
  });

  it('uses custom formatLabel', () => {
    render(
      <DurationBadge
        durationSeconds={300}
        formatLabel={(s) => `${Math.round(s / 60)} perc`}
      />,
    );
    expect(screen.getByText('5 perc')).toBeInTheDocument();
    expect(screen.queryByText('5 min')).not.toBeInTheDocument();
  });

  it('formatLabel receives sub-minute seconds', () => {
    render(
      <DurationBadge
        durationSeconds={20}
        formatLabel={(s) => `${s}s`}
      />,
    );
    expect(screen.getByText('20s')).toBeInTheDocument();
  });

  it('renders nothing when no data', () => {
    const { container } = render(<DurationBadge formatLabel={fmt} />);
    expect(container.innerHTML).toBe('');
  });

  it('has no a11y violations', async () => {
    const { container } = render(<DurationBadge durationSeconds={300} formatLabel={fmt} />);
    await expectNoA11yViolations(container);
  });
});
