import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContactForm } from './ContactForm';

// Mock submitLead but keep describeIssues as the real implementation
vi.mock('@/lib/leads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/leads')>();
  return {
    ...actual,
    submitLead: vi.fn(),
  };
});

const mockSubmitLead = vi.mocked((await import('@/lib/leads')).submitLead);

const validation = {
  required: 'Please fill in {{field}}.',
  email: 'Enter a valid work email address, for example name@company.com.',
  consent: 'Please agree to the privacy policy so we can reply.',
  select: 'Please choose an option for {{field}}.',
  tooLong: '{{field}} is too long.',
};

const defaultContent = {
  fields: {
    name: 'Your name',
    email: 'Email address',
    subject: 'Subject',
    message: 'Message',
    consent: 'I consent to NestSelf processing my data.',
  },
  privacyLinkText: 'Privacy Policy',
  submit: 'Send message',
  submitting: 'Sending...',
  errorSummaryTitle: 'Please fix the following errors',
  successTitle: 'Message sent',
  successBody: 'Thank you for reaching out.',
  errorTitle: 'Something went wrong',
  errorBody: 'Could not send.',
  errorContactHint: 'You can also reach us at',
  fallbackErrorLabel: 'Form',
  fallbackErrorMessage: 'Submission failed. Please check your entries and try again.',
  validation,
};

describe('ContactForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all required fields', () => {
    render(<ContactForm locale="en" content={defaultContent} />);
    expect(screen.getByText('Your name')).toBeInTheDocument();
    expect(screen.getByText('Email address')).toBeInTheDocument();
    expect(screen.getByText('Subject')).toBeInTheDocument();
    expect(screen.getByText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('shows friendly validation messages when submitting empty form', async () => {
    render(<ContactForm locale="en" content={defaultContent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Friendly messages appear in the error summary, not raw zod text
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Please agree to the privacy policy so we can reply.');
    expect(alert.textContent).toContain('Please fill in Your name.');
    expect(alert.textContent).toContain('Please fill in Subject.');
    expect(alert.textContent).toContain('Please fill in Message.');
    // Raw zod messages should NOT appear
    expect(alert.textContent).not.toContain('Too small');
    expect(alert.textContent).not.toContain('Invalid input');
    expect(mockSubmitLead).not.toHaveBeenCalled();
  });

  it('shows the email-specific message for a bad email', async () => {
    render(<ContactForm locale="en" content={defaultContent} />);
    // Fill in all fields except email (put an invalid one)
    fireEvent.change(screen.getByRole('textbox', { name: /your name/i }), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'not-valid' } });
    fireEvent.change(screen.getByRole('textbox', { name: /subject/i }), { target: { value: 'Question' } });
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: 'Hello there.' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Enter a valid work email address, for example name@company.com.');
  });

  it('shows success panel after valid submission', async () => {
    mockSubmitLead.mockResolvedValue({
      ok: true,
      data: { id: '1', kind: 'contact', receivedAt: '2026-01-01T00:00:00Z' },
    });

    render(<ContactForm locale="en" content={defaultContent} />);

    fireEvent.change(screen.getByRole('textbox', { name: /your name/i }), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByRole('textbox', { name: /subject/i }), { target: { value: 'Question' } });
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: 'Hello there.' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Message sent')).toBeInTheDocument();
    });
  });

  it('shows error panel on network failure', async () => {
    mockSubmitLead.mockResolvedValue({ ok: false, status: 0 });

    render(<ContactForm locale="en" content={defaultContent} />);

    fireEvent.change(screen.getByRole('textbox', { name: /your name/i }), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByRole('textbox', { name: /subject/i }), { target: { value: 'Question' } });
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: 'Hello there.' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });
});
