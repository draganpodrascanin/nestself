import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard, MetricGroup } from './MetricCard';
import { expectNoA11yViolations } from '../../../test/axe';

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Active employees" value="142" />);
    expect(screen.getByText('Active employees')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('renders hint when provided', () => {
    render(<MetricCard label="Sessions" value="38" hint="+12% from last month" />);
    expect(screen.getByText('+12% from last month')).toBeInTheDocument();
  });

  it('value has tabular-nums', () => {
    const { container } = render(<MetricCard label="Count" value="99" />);
    const valueParagraph = container.querySelector('p');
    expect(valueParagraph?.className).toContain('tabular-nums');
  });

  it('does not render dt or dd elements', () => {
    const { container } = render(<MetricCard label="Total" value="250" />);
    expect(container.querySelector('dt')).toBeNull();
    expect(container.querySelector('dd')).toBeNull();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<MetricCard label="Total" value="250" />);
    await expectNoA11yViolations(container);
  });
});

describe('MetricGroup', () => {
  it('renders a group with an accessible label', () => {
    render(
      <MetricGroup label="Key metrics">
        <MetricCard label="Users" value="100" />
        <MetricCard label="Sessions" value="50" />
      </MetricGroup>,
    );
    const group = screen.getByRole('group', { name: 'Key metrics' });
    expect(group).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <MetricGroup label="Dashboard metrics">
        <MetricCard label="Revenue" value="1,200" />
      </MetricGroup>,
    );
    await expectNoA11yViolations(container);
  });
});
