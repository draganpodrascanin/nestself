import { describe, expect, it, vi } from 'vitest';
import { AuthoritativeDnsTxtResolver, FakeDnsTxtResolver, type DnsBackend } from './dns-txt-resolver.js';

function backend(overrides: Partial<DnsBackend> = {}): DnsBackend {
  return {
    resolveNs: vi.fn(async (zone: string) => {
      if (zone === 'acme.example') return ['ns2.acme-dns.example', 'ns1.acme-dns.example'];
      throw Object.assign(new Error('no data'), { code: 'ENODATA' });
    }),
    resolve4: vi.fn(async () => ['192.0.2.53']),
    resolve6: vi.fn(async () => ['2001:db8::53']),
    resolveTxtAt: vi.fn(async () => [['nestself-domain-verification=', 'abc'], ['v=spf1 -all']]),
    ...overrides,
  };
}

describe('AuthoritativeDnsTxtResolver', () => {
  it('asks one authoritative server of the closest zone directly and joins TXT chunks', async () => {
    const b = backend();
    const values = await new AuthoritativeDnsTxtResolver(b).lookupTxt('_nestself-verify.eu.acme.example');
    expect(values).toEqual(['nestself-domain-verification=abc', 'v=spf1 -all']);
    expect(b.resolveNs).toHaveBeenNthCalledWith(1, 'eu.acme.example');
    expect(b.resolveNs).toHaveBeenNthCalledWith(2, 'acme.example');
    expect(b.resolve4).toHaveBeenCalledWith('ns1.acme-dns.example');
    expect(b.resolveTxtAt).toHaveBeenCalledWith('192.0.2.53', '_nestself-verify.eu.acme.example', 5000);
  });

  it('falls back to IPv6 for the name server address', async () => {
    const b = backend({ resolve4: vi.fn(async () => { throw new Error('none'); }) });
    await new AuthoritativeDnsTxtResolver(b).lookupTxt('_nestself-verify.acme.example');
    expect(b.resolveTxtAt).toHaveBeenCalledWith('2001:db8::53', '_nestself-verify.acme.example', 5000);
  });

  it('returns an empty list when no zone has name servers, the query fails or it times out', async () => {
    const none = backend({ resolveNs: vi.fn(async () => { throw new Error('ENOTFOUND'); }) });
    expect(await new AuthoritativeDnsTxtResolver(none).lookupTxt('_nestself-verify.acme.example')).toEqual([]);
    expect(none.resolveNs).not.toHaveBeenCalledWith('example');

    const refused = backend({ resolveTxtAt: vi.fn(async () => { throw new Error('ENOTFOUND'); }) });
    expect(await new AuthoritativeDnsTxtResolver(refused).lookupTxt('_nestself-verify.acme.example')).toEqual([]);

    const slow = backend({ resolveTxtAt: vi.fn(() => new Promise<string[][]>(() => undefined)) });
    expect(await new AuthoritativeDnsTxtResolver(slow, 20).lookupTxt('_nestself-verify.acme.example')).toEqual([]);
  });
});

describe('FakeDnsTxtResolver', () => {
  it('serves set records case-insensitively, else the fallback, else nothing', async () => {
    const plain = new FakeDnsTxtResolver();
    plain.setTxt('_nestself-verify.Acme.example', ['x']);
    expect(await plain.lookupTxt('_nestself-verify.acme.example')).toEqual(['x']);
    expect(await plain.lookupTxt('_nestself-verify.other.example')).toEqual([]);
    plain.clear();
    expect(await plain.lookupTxt('_nestself-verify.acme.example')).toEqual([]);

    const withFallback = new FakeDnsTxtResolver(async (name) => [`auto:${name}`]);
    expect(await withFallback.lookupTxt('n')).toEqual(['auto:n']);
    const failing = new FakeDnsTxtResolver(async () => { throw new Error('db down'); });
    expect(await failing.lookupTxt('n')).toEqual([]);
  });
});
