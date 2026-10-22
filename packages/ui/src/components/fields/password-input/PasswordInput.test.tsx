import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('renders as a password field by default', () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('toggles visibility on button click', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(
      screen.getByRole('button', { name: 'Hide password' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('supports custom show/hide labels', () => {
    render(
      <PasswordInput
        aria-label="Password"
        showLabel="Prikazi"
        hideLabel="Sakrij"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Prikazi' }),
    ).toBeInTheDocument();
  });

  it('toggle is keyboard accessible', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });
});
