import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/leads/demo-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeParams(kind: string) {
  return { params: Promise.resolve({ kind }) };
}

const validDemo = {
  kind: 'demo_request' as const,
  name: 'Ana Petrovic',
  email: 'ana@company.com',
  company: 'Acme d.o.o.',
  companySize: '51-200' as const,
  country: 'RS' as const,
  locale: 'en' as const,
  consent: true as const,
};

describe('POST /api/leads/[kind]', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.API_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.API_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.API_URL = originalEnv;
    } else {
      delete process.env.API_URL;
    }
  });

  it('returns 404 for unknown kind', async () => {
    const req = new Request('http://localhost:3000/api/leads/unknown', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await POST(req, makeParams('unknown'));
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('http://localhost:3000/api/leads/demo-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req, makeParams('demo-requests'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.issues).toBeDefined();
  });

  it('returns 400 on schema validation failure', async () => {
    const req = makeRequest({ kind: 'demo_request', name: '' });
    const res = await POST(req, makeParams('demo-requests'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.issues.length).toBeGreaterThan(0);
  });

  it('returns 503 when API_URL is not configured', async () => {
    const req = makeRequest(validDemo);
    const res = await POST(req, makeParams('demo-requests'));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('not_configured');
  });

  it('passes through 202 from upstream', async () => {
    process.env.API_URL = 'http://api.test';
    const accepted = { id: '123', kind: 'demo_request', receivedAt: '2026-01-01T00:00:00Z' };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 202,
      text: () => Promise.resolve(JSON.stringify(accepted)),
    }));

    const req = makeRequest(validDemo);
    const res = await POST(req, makeParams('demo-requests'));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.id).toBe('123');
  });

  it('passes through 429 from upstream', async () => {
    process.env.API_URL = 'http://api.test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 429,
      text: () => Promise.resolve(JSON.stringify({ error: 'rate_limited' })),
    }));

    const req = makeRequest(validDemo);
    const res = await POST(req, makeParams('demo-requests'));
    expect(res.status).toBe(429);
  });
});
