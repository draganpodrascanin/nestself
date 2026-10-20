import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './MetricCard';
import { expectNoA11yViolations } from '../../../test/axe';

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<dl><MetricCard label="Active employees" value="142" /></dl>);
    expect(screen.getByText('Active employees')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('renders hint when provided', () => {
    render(<dl><MetricCard label="Sessions" value="38" hint="+12% from last month" /></dl>);
    expect(screen.getByText('+12% from last month')).toBeInTheDocument();
  });

  it('value has tabular-nums', () => {
    const { container } = render(<dl><MetricCard label="Count" value="99" /></dl>);
    const dd = container.querySelector('dd');
    expect(dd?.className).toContain('tabular-nums');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<dl><MetricCard label="Total" value="250" /></dl>);
    await expectNoA11yViolations(container);
  });
});
