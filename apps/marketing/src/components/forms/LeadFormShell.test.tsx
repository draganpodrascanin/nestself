import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeadFormShell } from './LeadFormShell';

const defaultProps = {
  status: 'idle' as const,
  errors: [],
  errorSummaryTitle: 'Errors',
  submitLabel: 'Submit',
  pendingLabel: 'Submitting...',
  successTitle: 'Success',
  successBody: 'Done!',
  errorTitle: 'Error',
  errorBody: 'Something went wrong.',
  errorContactHint: 'You can also reach us at',
  onSubmit: vi.fn(),
};

describe('LeadFormShell', () => {
  it('renders the form with children and submit button', () => {
    render(
      <LeadFormShell {...defaultProps}>
        <input name="test" />
      </LeadFormShell>,
    );
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('shows success panel when status is success', () => {
    render(
      <LeadFormShell {...defaultProps} status="success">
        <input name="test" />
      </LeadFormShell>,
    );
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Done!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('shows error panel when status is error', () => {
    render(
      <LeadFormShell {...defaultProps} status="error">
        <input name="test" />
      </LeadFormShell>,
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });

  it('shows pending label on submit button when submitting', () => {
    render(
      <LeadFormShell {...defaultProps} status="submitting">
        <input name="test" />
      </LeadFormShell>,
    );
    const button = screen.getByRole('button', { name: 'Submitting...' });
    expect(button).toBeDisabled();
  });

  it('includes a honeypot field hidden from users', () => {
    const { container } = render(
      <LeadFormShell {...defaultProps}>
        <input name="test" />
      </LeadFormShell>,
    );
    const honeypot = container.querySelector('input[name="website"]');
    expect(honeypot).toBeInTheDocument();
    expect(honeypot?.getAttribute('tabindex')).toBe('-1');
  });

  it('calls onSubmit when the form is submitted', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <LeadFormShell {...defaultProps} onSubmit={onSubmit}>
        <input name="test" />
      </LeadFormShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
