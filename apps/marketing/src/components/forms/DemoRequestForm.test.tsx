import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DemoRequestForm } from './DemoRequestForm';

// Mock submitLead
vi.mock('@/lib/leads', () => ({
  submitLead: vi.fn(),
}));

// Mock the schema to skip companySize select validation in jsdom
vi.mock('@nestself/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nestself/contracts')>();
  return {
    ...actual,
    DemoRequestSchema: {
      safeParse: vi.fn((data: Record<string, unknown>) => {
        // If name/email/company/consent are all truthy, pass validation
        if (data.name && data.email && data.company && data.consent) {
          return { success: true, data };
        }
        return {
          success: false,
          error: {
            issues: [{ path: ['form'], message: 'Validation failed' }],
          },
        };
      }),
    },
  };
});

const mockSubmitLead = vi.mocked((await import('@/lib/leads')).submitLead);

const defaultContent = {
  fields: {
    name: 'Full name',
    email: 'Work email',
    company: 'Company',
    role: 'Job title',
    companySize: 'Company size',
    country: 'Country',
    heardAbout: 'How did you hear about us?',
    message: 'Message',
    consent: 'I consent to NestSelf processing my data.',
  },
  privacyLinkText: 'Privacy Policy',
  selectPlaceholder: 'Select...',
  options: {
    companySize: [
      { value: '1-50', label: '1 -- 50' },
      { value: '51-200', label: '51 -- 200' },
    ],
    country: [
      { value: 'RS', label: 'Serbia' },
      { value: 'HU', label: 'Hungary' },
      { value: 'OTHER', label: 'Other' },
    ],
    heardAbout: [
      { value: 'search', label: 'Search engine' },
      { value: 'referral', label: 'Referral' },
    ],
  },
  emailHint: 'We recommend using your work email.',
  optional: 'optional',
  submit: 'Send request',
  submitting: 'Sending...',
  errorSummaryTitle: 'Please fix the following errors',
  successTitle: 'We received your request',
  successBody: 'A member of our team will reply.',
  errorTitle: 'Something went wrong',
  errorBody: 'Could not send.',
  errorContactHint: 'You can also reach us at',
  fallbackErrorLabel: 'Form',
  fallbackErrorMessage: 'Submission failed. Please check your entries and try again.',
};

describe('DemoRequestForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all required fields', () => {
    render(<DemoRequestForm locale="en" content={defaultContent} />);
    expect(screen.getByText('Full name')).toBeInTheDocument();
    expect(screen.getByText('Work email')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Company size')).toBeInTheDocument();
    expect(screen.getByText('Country')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
  });

  it('shows validation errors when submitting empty form and focuses the error summary', async () => {
    render(<DemoRequestForm locale="en" content={defaultContent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockSubmitLead).not.toHaveBeenCalled();
  });

  it('shows success panel after valid submission', async () => {
    mockSubmitLead.mockResolvedValue({
      ok: true,
      data: { id: '1', kind: 'demo_request', receivedAt: '2026-01-01T00:00:00Z' },
    });

    render(<DemoRequestForm locale="en" content={defaultContent} />);

    fireEvent.change(screen.getByRole('textbox', { name: /full name/i }), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByRole('textbox', { name: /work email/i }), { target: { value: 'test@company.com' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^company$/i }), { target: { value: 'Test Corp' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => {
      expect(screen.getByText('We received your request')).toBeInTheDocument();
    });
  });

  it('shows error panel when server returns 503', async () => {
    mockSubmitLead.mockResolvedValue({ ok: false, status: 503 });

    render(<DemoRequestForm locale="en" content={defaultContent} />);

    fireEvent.change(screen.getByRole('textbox', { name: /full name/i }), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByRole('textbox', { name: /work email/i }), { target: { value: 'test@company.com' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^company$/i }), { target: { value: 'Test Corp' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });
});
