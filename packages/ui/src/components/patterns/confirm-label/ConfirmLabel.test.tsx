import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfirmLabel } from './ConfirmLabel';
import { expectNoA11yViolations } from '../../../test/axe';

describe('ConfirmLabel', () => {
  it('includes the amount in the accessible name', () => {
    render(
      <button>
        <ConfirmLabel action="Confirm and pay" amount="€10.00" />
      </button>,
    );
    const btn = screen.getByRole('button', { name: /€10\.00/ });
    expect(btn).toBeInTheDocument();
  });

  it('renders action and amount together', () => {
    render(<ConfirmLabel action="Confirm and pay" amount="€25.00" />);
    expect(screen.getByText('Confirm and pay €25.00')).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <button>
        <ConfirmLabel action="Confirm" amount="€5.00" />
      </button>,
    );
    await expectNoA11yViolations(container);
  });
});
