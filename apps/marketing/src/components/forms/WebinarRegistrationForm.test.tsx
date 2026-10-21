import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebinarRegistrationForm } from './WebinarRegistrationForm';
import type { WebinarRegistrationFormLabels } from './WebinarRegistrationForm';

vi.mock('@/lib/leads', () => ({
  submitLead: vi.fn(),
}));

vi.mock('@/lib/contact', () => ({
  CONTACT_EMAIL: 'hello@nestself.example',
}));

const mockSubmitLead = vi.mocked((await import('@/lib/leads')).submitLead);

const labels: WebinarRegistrationFormLabels = {
  nameLabel: 'Full name',
  namePlaceholder: 'Your full name',
  emailLabel: 'Email address',
  emailPlaceholder: 'you@company.com',
  companyLabel: 'Company',
  companyPlaceholder: 'Your company (optional)',
  optionalLabel: 'optional',
  consentShortLabel: 'Data processing consent',
  consentLabel: 'I consent to NestSelf processing my data as described in the {privacyLink} to respond to my registration.',
  privacyLinkText: 'Privacy Policy',
  privacyLinkHref: '/legal/privacy',
  submitLabel: 'Register',
  errorSummaryTitle: 'Please fix the following errors',
  nameRequired: 'Please enter your name.',
  emailRequired: 'Please enter a valid email address.',
  consentRequired: 'You must consent to data processing.',
  successTitle: 'You are registered',
  successBody: 'We will email you the link before the webinar starts.',
  failureTitle: 'We could not send your registration',
  failureBody: 'Please try again later or contact us at {email}.',
  serverErrorLabel: 'Server error',
};

const defaultProps = {
  webinarSlug: 'test-webinar',
  locale: 'en' as const,
  labels,
};

describe('WebinarRegistrationForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the form with required fields', () => {
    render(<WebinarRegistrationForm {...defaultProps} />);
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/company/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
  });

  it('shows error summary and focuses it when submitted with empty fields', async () => {
    const user = userEvent.setup();
    render(<WebinarRegistrationForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Error messages appear in both the summary and the field; just check they exist
    expect(screen.getAllByText(/please enter your name/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/please enter a valid email/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/you must consent/i).length).toBeGreaterThanOrEqual(1);

    // The error summary should receive focus (requestAnimationFrame in jsdom needs a tick)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveFocus();
    });
  });

  it('calls submitLead with the right body on valid submit', async () => {
    const user = userEvent.setup();
    mockSubmitLead.mockResolvedValue({
      ok: true,
      data: { id: '1', kind: 'webinar_registration', receivedAt: '2026-01-01T00:00:00Z' },
    });

    render(<WebinarRegistrationForm {...defaultProps} />);

    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/email address/i), 'jane@example.com');

    // Click the consent checkbox
    const consentCheckbox = screen.getByRole('checkbox');
    await user.click(consentCheckbox);

    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(mockSubmitLead).toHaveBeenCalledOnce();
    });

    const [path, body] = mockSubmitLead.mock.calls[0]!;
    expect(path).toBe('webinar-registrations');
    expect(body).toMatchObject({
      kind: 'webinar_registration',
      webinarSlug: 'test-webinar',
      name: 'Jane Doe',
      email: 'jane@example.com',
      consent: true,
      locale: 'en',
    });

    // Shows success
    await waitFor(() => {
      expect(screen.getByText(/you are registered/i)).toBeInTheDocument();
    });
  });

  it('shows failure message on 503 response', async () => {
    const user = userEvent.setup();
    mockSubmitLead.mockResolvedValue({ ok: false, status: 503 });

    render(<WebinarRegistrationForm {...defaultProps} />);

    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/email address/i), 'jane@example.com');
    const consentCheckbox = screen.getByRole('checkbox');
    await user.click(consentCheckbox);

    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(screen.getByText(/we could not send your registration/i)).toBeInTheDocument();
    });
  });

  it('shows failure message on network error', async () => {
    const user = userEvent.setup();
    mockSubmitLead.mockResolvedValue({ ok: false, status: 0 });

    render(<WebinarRegistrationForm {...defaultProps} />);

    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/email address/i), 'jane@example.com');
    const consentCheckbox = screen.getByRole('checkbox');
    await user.click(consentCheckbox);

    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(screen.getByText(/we could not send your registration/i)).toBeInTheDocument();
    });
  });

  it('has a honeypot field that is visually hidden and aria-hidden', () => {
    render(<WebinarRegistrationForm {...defaultProps} />);
    const honeypot = document.querySelector('input[name="website"]');
    expect(honeypot).toBeTruthy();
    expect(honeypot!.getAttribute('tabindex')).toBe('-1');
    expect(honeypot!.closest('[aria-hidden="true"]')).toBeTruthy();
  });
});
