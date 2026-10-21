import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContactForm } from './ContactForm';

vi.mock('@/lib/leads', () => ({
  submitLead: vi.fn(),
}));

const mockSubmitLead = vi.mocked((await import('@/lib/leads')).submitLead);

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

  it('shows validation errors when submitting empty form', async () => {
    render(<ContactForm locale="en" content={defaultContent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockSubmitLead).not.toHaveBeenCalled();
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
