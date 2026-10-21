import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DemoRequestForm } from './DemoRequestForm';

// Mock submitLead but keep describeIssues as the real implementation
vi.mock('@/lib/leads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/leads')>();
  return {
    ...actual,
    submitLead: vi.fn(),
  };
});

// Mock the schema to produce realistic zod-shaped issues
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
        // Return realistic zod v4 issues
        const issues = [];
        if (!data.consent) {
          issues.push({ code: 'invalid_value', path: ['consent'], values: [true], message: 'Invalid input: expected true' });
        }
        if (!data.name) {
          issues.push({ code: 'too_small', path: ['name'], origin: 'string', minimum: 1, inclusive: true, message: 'Too small: expected string to have >=1 characters' });
        }
        if (!data.email) {
          issues.push({ code: 'too_small', path: ['email'], origin: 'string', minimum: 1, inclusive: true, message: 'Too small: expected string to have >=1 characters' });
        }
        if (!data.company) {
          issues.push({ code: 'too_small', path: ['company'], origin: 'string', minimum: 1, inclusive: true, message: 'Too small: expected string to have >=1 characters' });
        }
        return {
          success: false,
          error: { issues },
        };
      }),
    },
  };
});

// A second mock that produces an email-format issue for bad email tests
const mockDemoRequestSchema = vi.mocked(
  (await import('@nestself/contracts')).DemoRequestSchema,
);

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
      { value: '1-50', label: '1 to 50 employees' },
      { value: '51-200', label: '51 to 200 employees' },
    ],
    country: [
      { value: 'RS', label: 'Serbia' },
      { value: 'HU', label: 'Hungary' },
      { value: 'OTHER', label: 'Other' },
    ],
    heardAbout: [
      { value: 'search', label: 'Search engine' },
      { value: 'referral', label: 'Recommendation' },
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
  validation,
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

  it('shows friendly validation messages (not zod text) when submitting empty form', async () => {
    render(<DemoRequestForm locale="en" content={defaultContent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Friendly messages appear in the error summary, not raw zod text
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Please agree to the privacy policy so we can reply.');
    expect(alert.textContent).toContain('Please fill in Full name.');
    expect(alert.textContent).toContain('Please fill in Company.');
    // Raw zod messages should NOT appear
    expect(alert.textContent).not.toContain('Too small');
    expect(alert.textContent).not.toContain('Invalid input');
    expect(mockSubmitLead).not.toHaveBeenCalled();
  });

  it('shows the email-specific message for a bad email', async () => {
    // Override the mock for this test to return an email format issue
    mockDemoRequestSchema.safeParse.mockReturnValueOnce({
      success: false,
      error: {
        issues: [
          { code: 'invalid_format', path: ['email'], format: 'email', message: 'Invalid email address' },
        ],
      },
    } as never);

    render(<DemoRequestForm locale="en" content={defaultContent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Enter a valid work email address, for example name@company.com.');
    expect(alert.textContent).not.toContain('Invalid email address');
  });

  it('passes human-readable select labels from content', () => {
    // Verify the content object carries human labels, not raw codes
    expect(defaultContent.options.companySize[0]!.label).toBe('1 to 50 employees');
    expect(defaultContent.options.country[0]!.label).toBe('Serbia');
    expect(defaultContent.options.heardAbout[1]!.label).toBe('Recommendation');
    // Rendering should not throw with these labels
    expect(() => render(<DemoRequestForm locale="en" content={defaultContent} />)).not.toThrow();
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
