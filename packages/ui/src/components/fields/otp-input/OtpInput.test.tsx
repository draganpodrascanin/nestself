import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpInput } from './OtpInput';

describe('OtpInput', () => {
  it('renders with numeric input mode and one-time-code autocomplete', () => {
    render(<OtpInput aria-label="Code" />);
    const input = screen.getByLabelText('Code');
    expect(input).toHaveAttribute('inputMode', 'numeric');
    expect(input).toHaveAttribute('autoComplete', 'one-time-code');
    expect(input).toHaveAttribute('maxLength', '6');
  });

  it('strips non-digit characters on input', async () => {
    const user = userEvent.setup();
    render(<OtpInput aria-label="Code" />);
    const input = screen.getByLabelText('Code') as HTMLInputElement;

    await user.type(input, '12ab34');
    expect(input.value).toBe('1234');
  });

  it('handles paste of full code with spaces', async () => {
    const user = userEvent.setup();
    render(<OtpInput aria-label="Code" />);
    const input = screen.getByLabelText('Code') as HTMLInputElement;

    await user.click(input);
    await user.paste('123 456');
    expect(input.value).toBe('123456');
  });

  it('limits to specified length', () => {
    render(<OtpInput aria-label="Code" length={4} />);
    const input = screen.getByLabelText('Code') as HTMLInputElement;
    expect(input).toHaveAttribute('maxLength', '4');
  });

  it('is keyboard accessible via Tab', async () => {
    const user = userEvent.setup();
    render(<OtpInput aria-label="Code" />);
    await user.tab();
    expect(screen.getByLabelText('Code')).toHaveFocus();
  });
});
