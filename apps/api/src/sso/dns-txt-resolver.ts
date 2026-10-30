/**
 * DNS TXT lookups for SSO domain verification (3.4.4, SSO-R-06).
 *
 * `AuthoritativeDnsTxtResolver` finds the zone's name servers, resolves one
 * of them to an address and asks it directly (a dedicated `Resolver` with
 * `setServers`), so a stale record in a local or recursive cache cannot
 * verify a domain. Every failure (no NS, timeout, NXDOMAIN, refused) yields
 * an empty list: the caller treats that as "not verified".
 *
 * `FakeDnsTxtResolver` serves records from a map for tests and stub mode.
 */
import { Resolver, resolve4, resolve6, resolveNs } from 'node:dns/promises';

/** DI token of the {@link DnsTxtResolver} the SSO service uses. */
export const DNS_TXT_RESOLVER = Symbol('DNS_TXT_RESOLVER');

export interface DnsTxtResolver {
  /** TXT values of `name` (each record's chunks joined); empty on any failure. */
  lookupTxt(name: string): Promise<string[]>;
}

export const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/** The DNS functions the authoritative resolver needs; injectable for tests. */
export interface DnsBackend {
  resolveNs(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  /** TXT records of `name` asked of the server at `address` only. */
  resolveTxtAt(address: string, name: string, timeoutMs: number): Promise<string[][]>;
}

const nodeBackend: DnsBackend = {
  resolveNs,
  resolve4,
  resolve6,
  async resolveTxtAt(address, name, timeoutMs) {
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    resolver.setServers([address]);
    return resolver.resolveTxt(name);
  },
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS lookup timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class AuthoritativeDnsTxtResolver implements DnsTxtResolver {
  constructor(
    private readonly backend: DnsBackend = nodeBackend,
    private readonly timeoutMs = DNS_LOOKUP_TIMEOUT_MS,
  ) {}

  async lookupTxt(name: string): Promise<string[]> {
    try {
      return await withTimeout(this.lookup(name), this.timeoutMs);
    } catch {
      return [];
    }
  }

  private async lookup(name: string): Promise<string[]> {
    const nameServer = await this.findNameServer(name);
    if (!nameServer) return [];
    const address = await this.addressOf(nameServer);
    if (!address) return [];
    const records = await this.backend.resolveTxtAt(address, name, this.timeoutMs);
    return records.map((chunks) => chunks.join(''));
  }

  /**
   * The first name server of the closest enclosing zone: `_nestself-verify.
   * eu.acme.example` tries `eu.acme.example`, then `acme.example`. A
   * top-level label alone is never queried.
   */
  private async findNameServer(name: string): Promise<string | null> {
    const labels = name.replace(/\.$/, '').split('.');
    for (let i = 1; i < labels.length - 1; i += 1) {
      const zone = labels.slice(i).join('.');
      try {
        const servers = await this.backend.resolveNs(zone);
        if (servers.length > 0) return [...servers].sort()[0]!;
      } catch {
        // No delegation at this level (ENODATA/ENOTFOUND): try the parent.
      }
    }
    return null;
  }

  private async addressOf(host: string): Promise<string | null> {
    try {
      const v4 = await this.backend.resolve4(host);
      if (v4.length > 0) return v4[0]!;
    } catch {
      // Fall through to IPv6.
    }
    try {
      const v6 = await this.backend.resolve6(host);
      if (v6.length > 0) return v6[0]!;
    } catch {
      // Neither family resolves.
    }
    return null;
  }
}

/**
 * In-memory TXT records. `fallback` answers names without a record; stub
 * mode with `FAKE_DNS_TXT_AUTOVERIFY=true` uses it to return the expected
 * value of every pending domain (Playwright).
 */
export class FakeDnsTxtResolver implements DnsTxtResolver {
  private readonly records = new Map<string, string[]>();

  constructor(private readonly fallback?: (name: string) => Promise<string[]>) {}

  setTxt(name: string, values: string[]): void {
    this.records.set(name.toLowerCase(), [...values]);
  }

  clear(): void {
    this.records.clear();
  }

  async lookupTxt(name: string): Promise<string[]> {
    const values = this.records.get(name.toLowerCase());
    if (values) return [...values];
    if (!this.fallback) return [];
    try {
      return await this.fallback(name);
    } catch {
      return [];
    }
  }
}
