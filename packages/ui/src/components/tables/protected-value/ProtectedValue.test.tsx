import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProtectedValue } from './ProtectedValue';
import { expectNoA11yViolations } from '../../../test/axe';

describe('ProtectedValue', () => {
  it('renders the label word', () => {
    render(<ProtectedValue label="Protected" reason="Salary data is restricted" />);
    expect(screen.getByText('Protected')).toBeInTheDocument();
  });

  it('never renders digits', () => {
    const { container } = render(
      <ProtectedValue label="Protected" reason="Restricted data" />,
    );
    const textContent = container.textContent ?? '';
    expect(textContent).not.toMatch(/\d/);
  });

  it('exposes the reason via aria-describedby', () => {
    render(<ProtectedValue label="Protected" reason="HR data is restricted" />);
    const labelEl = screen.getByText('Protected');
    const describedById = labelEl.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const reasonEl = document.getElementById(describedById!);
    expect(reasonEl).toHaveTextContent('HR data is restricted');
  });

  it('renders LockKey icon', () => {
    const { container } = render(
      <ProtectedValue label="Protected" reason="Restricted" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <ProtectedValue label="Protected" reason="This value is restricted" />,
    );
    await expectNoA11yViolations(container);
  });
});
