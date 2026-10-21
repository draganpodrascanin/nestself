import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitLead } from './leads';

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
