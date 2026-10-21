import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitLead, describeIssues, type ValidationMessages, type ZodIssueSlice } from './leads';

describe('submitLead', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok with data on 202', async () => {
    const data = { id: '1', kind: 'demo_request' as const, receivedAt: '2026-01-01T00:00:00Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));

    const result = await submitLead('demo-requests', { name: 'Test' });
    expect(result).toEqual({ ok: true, data });
    expect(fetch).toHaveBeenCalledWith('/api/leads/demo-requests', expect.objectContaining({ method: 'POST' }));
  });

  it('returns issues on 400', async () => {
    const issues = [{ path: ['email'], message: 'Invalid email' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ issues }),
    }));

    const result = await submitLead('contact', { name: 'Test' });
    expect(result).toEqual({ ok: false, status: 400, issues });
  });

  it('returns status 0 on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const result = await submitLead('demo-requests', { name: 'Test' });
    expect(result).toEqual({ ok: false, status: 0 });
  });

  it('returns status without issues when response body is not json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error('not json')),
    }));

    const result = await submitLead('demo-requests', { name: 'Test' });
    expect(result).toEqual({ ok: false, status: 503 });
  });
});

const validation: ValidationMessages = {
  required: 'Please fill in {{field}}.',
  email: 'Enter a valid work email address, for example name@company.com.',
  consent: 'Please agree to the privacy policy so we can reply.',
  select: 'Please choose an option for {{field}}.',
  tooLong: '{{field}} is too long.',
};

const labels: Record<string, string> = {
  name: 'Full name',
  email: 'Work email',
  company: 'Company',
  companySize: 'Company size',
  country: 'Country',
  consent: 'Privacy consent',
  subject: 'Subject',
  message: 'Message',
};

describe('describeIssues', () => {
  it('maps too_small to the required template with the field label interpolated', () => {
    const issues: ZodIssueSlice[] = [
      { code: 'too_small', path: ['name'] },
    ];
    const result = describeIssues(issues, labels, validation);
    expect(result).toEqual([
      { id: 'field-name', label: 'Full name', message: 'Please fill in Full name.' },
    ]);
  });

  it('maps invalid_format with email format to the email template', () => {
    const issues: ZodIssueSlice[] = [
      { code: 'invalid_format', path: ['email'], format: 'email' },
    ];
    const result = describeIssues(issues, labels, validation);
    expect(result).toEqual([
      { id: 'field-email', label: 'Work email', message: 'Enter a valid work email address, for example name@company.com.' },
    ]);
  });

  it('maps invalid_value on consent to the consent template', () => {
    const issues: ZodIssueSlice[] = [
      { code: 'invalid_value', path: ['consent'] },
    ];
    const result = describeIssues(issues, labels, validation);
    expect(result).toEqual([
      { id: 'field-consent', label: 'Privacy consent', message: 'Please agree to the privacy policy so we can reply.' },
    ]);
  });

  it('maps invalid_value on a select field to the select template', () => {
    const issues: ZodIssueSlice[] = [
      { code: 'invalid_value', path: ['companySize'] },
    ];
    const result = describeIssues(issues, labels, validation);
    expect(result).toEqual([
      { id: 'field-companySize', label: 'Company size', message: 'Please choose an option for Company size.' },
    ]);
  });

  it('maps too_big to the tooLong template', () => {
    const issues: ZodIssueSlice[] = [
      { code: 'too_big', path: ['name'] },
    ];
    const result = describeIssues(issues, labels, validation);
    expect(result).toEqual([
      { id: 'field-name', label: 'Full name', message: 'Full name is too long.' },
    ]);
  });

  it('handles multiple issues from a single empty submit', () => {
    const issues: ZodIssueSlice[] = [
      { code: 'invalid_value', path: ['consent'] },
      { code: 'too_small', path: ['name'] },
      { code: 'invalid_format', path: ['email'], format: 'email' },
      { code: 'too_small', path: ['company'] },
      { code: 'invalid_value', path: ['companySize'] },
    ];
    const result = describeIssues(issues, labels, validation);
    expect(result).toHaveLength(5);
    expect(result[0]!.message).toBe('Please agree to the privacy policy so we can reply.');
    expect(result[1]!.message).toBe('Please fill in Full name.');
    expect(result[2]!.message).toBe('Enter a valid work email address, for example name@company.com.');
    expect(result[3]!.message).toBe('Please fill in Company.');
    expect(result[4]!.message).toBe('Please choose an option for Company size.');
  });

  it('falls back to the field path name when no label is available', () => {
    const issues: ZodIssueSlice[] = [
      { code: 'too_small', path: ['unknownField'] },
    ];
    const result = describeIssues(issues, labels, validation);
    expect(result[0]!.label).toBe('unknownField');
    expect(result[0]!.message).toBe('Please fill in unknownField.');
  });
});
