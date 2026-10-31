/**
 * The one place the API fetches a tenant-supplied URL: SAML IdP metadata,
 * for its signing-certificate expiry (spec 5.8). Outbound fetches follow
 * the rule `assertPublicHttpsUrl` enforces before any connection:
 *
 * - `https:` only, and no credentials in the URL;
 * - the host is resolved and every address it resolves to must be public
 *   unicast (`isPublicAddress`): a host that answers with one public and one
 *   private address is refused, and so is an address literal that is not
 *   public. Nothing is requested from a refused URL.
 *
 * `HttpsMetadataFetcher` then fetches with the global `fetch`: no redirects
 * (`redirect: 'manual'`, any 3xx is a failure, so metadata URLs must be
 * direct and a redirect cannot lead to an unchecked host), no cookies or
 * credentials, a 5-second timeout for the whole exchange and a 1 MiB cap on
 * the body, enforced while it streams.
 *
 * Accepted residual (DNS rebinding): the addresses checked here come from
 * one lookup, and `fetch` resolves the host again when it connects. A host
 * whose DNS answers with a public address at validation time and a private
 * one at connect time is not caught; pinning the checked address would take
 * a custom connector, which the plan does not add.
 *
 * Errors carry a fixed reason and a message without the URL; log them with
 * `metadataFailureLabel`, never with the URL (its query may hold a tenant
 * identifier) or the body.
 *
 * `FakeMetadataFetcher` is the stub-mode and test adapter. It never touches
 * DNS or the network: hosts resolve from a table (a host without an entry
 * answers a public documentation address), and a URL nothing seeded serves
 * the fixture metadata `SAMPLE_SAML_METADATA`, so stub-mode SAML connections
 * get a realistic expiry. A test that needs a failure seeds one.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { SAMPLE_SAML_METADATA } from '../identity/saml-metadata.fixture.js';
import { isPublicAddress } from './public-address.js';

/** DI token of the {@link MetadataFetcher}; `IdentityModule` provides it. */
export const METADATA_FETCHER = Symbol('METADATA_FETCHER');

export const METADATA_FETCH_TIMEOUT_MS = 5_000;
export const METADATA_MAX_BYTES = 1_048_576;

/** Every address `hostname` resolves to. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export interface MetadataFetcher {
  /**
   * How this fetcher resolves host names. `assertPublicHttpsUrl(url, fetcher.lookup)`
   * judges a URL by the answers the fetcher itself gets (the SSO service
   * validates URLs this way before storing them).
   */
  readonly lookup: HostLookup;
  /** The document at `url`; rejects with {@link MetadataUrlError} or {@link MetadataFetchError}. */
  fetchXml(url: string): Promise<string>;
}

export type MetadataUrlRefusal = 'scheme' | 'host' | 'private_address';

const URL_REFUSAL_MESSAGES: Record<MetadataUrlRefusal, string> = {
  scheme: 'Only https: URLs are fetched',
  host: 'The URL must name a host that resolves, without credentials',
  private_address: 'The host resolves to an address that is not public',
};

/** A URL refused before any connection was made. */
export class MetadataUrlError extends Error {
  constructor(readonly reason: MetadataUrlRefusal) {
    super(URL_REFUSAL_MESSAGES[reason]);
    this.name = 'MetadataUrlError';
  }
}

export type MetadataFetchFailure = 'redirect' | 'status' | 'too_large' | 'timeout' | 'network';

const FETCH_FAILURE_MESSAGES: Record<MetadataFetchFailure, string> = {
  redirect: 'The metadata URL redirects; it must serve the document directly',
  status: 'The metadata URL did not answer with a 2xx status',
  too_large: 'The metadata document exceeds the size limit',
  timeout: 'The metadata URL did not answer in time',
  network: 'The metadata URL could not be reached',
};

/** A request that was made and did not yield a document. */
export class MetadataFetchError extends Error {
  constructor(
    readonly reason: MetadataFetchFailure,
    options?: { cause?: unknown },
  ) {
    super(FETCH_FAILURE_MESSAGES[reason], options);
    this.name = 'MetadataFetchError';
  }
}

/** What a log line may say about a failed fetch: the error's name and, for this module's errors, the reason. */
export function metadataFailureLabel(err: unknown): string {
  if (err instanceof MetadataUrlError || err instanceof MetadataFetchError) return `${err.name}: ${err.reason}`;
  return err instanceof Error ? err.name : 'unknown error';
}

/**
 * Resolves when `url` is an `https:` URL without credentials whose host is
 * a public address literal or resolves (through `lookup`) to public
 * addresses only; rejects with a {@link MetadataUrlError} otherwise.
 */
export async function assertPublicHttpsUrl(url: string, lookup: HostLookup): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MetadataUrlError('scheme');
  }
  if (parsed.protocol !== 'https:') throw new MetadataUrlError('scheme');
  if (parsed.username !== '' || parsed.password !== '' || parsed.hostname === '') throw new MetadataUrlError('host');

  // The URL parser normalises numeric hosts (`2130706433`, `0x7f.1`) to a dotted quad and brackets IPv6.
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0) {
    if (!isPublicAddress(host)) throw new MetadataUrlError('private_address');
    return;
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new MetadataUrlError('host');
  }
  if (addresses.length === 0) throw new MetadataUrlError('host');
  if (!addresses.every(isPublicAddress)) throw new MetadataUrlError('private_address');
}

/** `work`, unless `signal` aborts first: then a {@link MetadataFetchError} `timeout`. */
function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MetadataFetchError('timeout'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Every address of `hostname` from the system resolver, in the order it gave
 * them: `dns.promises.lookup` with `all` and `order: 'verbatim'` (the
 * current spelling of the deprecated `verbatim: true`).
 */
export const systemLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, order: 'verbatim' })).map((entry) => entry.address);

export interface HttpsMetadataFetcherOptions {
  lookup?: HostLookup;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export class HttpsMetadataFetcher implements MetadataFetcher {
  readonly lookup: HostLookup;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor({
    lookup = systemLookup,
    fetch = globalThis.fetch,
    timeoutMs = METADATA_FETCH_TIMEOUT_MS,
    maxBytes = METADATA_MAX_BYTES,
  }: HttpsMetadataFetcherOptions = {}) {
    this.lookup = lookup;
    this.fetchFn = fetch;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  async fetchXml(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // The deadline covers the lookup as well as the request and the body.
      await beforeDeadline(assertPublicHttpsUrl(url, this.lookup), controller.signal);
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: { accept: 'application/samlmetadata+xml, application/xml, text/xml' },
          signal: controller.signal,
        });
      } catch (err) {
        throw this.transportFailure(err, controller.signal);
      }
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        await res.body?.cancel().catch(() => undefined);
        throw new MetadataFetchError('redirect');
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new MetadataFetchError('status');
      }
      return await this.readCapped(res, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The body as text, refused as soon as it is declared or read past `maxBytes`. */
  private async readCapped(res: Response, signal: AbortSignal): Promise<string> {
    const declared = Number(res.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new MetadataFetchError('too_large');
    }
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw this.transportFailure(err, signal);
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new MetadataFetchError('too_large');
      }
      chunks.push(chunk.value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }

  private transportFailure(err: unknown, signal: AbortSignal): MetadataFetchError {
    return signal.aborted ? new MetadataFetchError('timeout') : new MetadataFetchError('network', { cause: err });
  }
}

/** What an unseeded host resolves to in the fake: a documentation address (TEST-NET-3), public by `isPublicAddress`. */
export const FAKE_PUBLIC_ADDRESS = '203.0.113.10';

/**
 * Stub mode and tests. `responses` maps a URL to the document it serves, or
 * to the error its fetch throws; a URL without an entry serves
 * `SAMPLE_SAML_METADATA` (signing certificate until `SIGNING_CERT_NOT_AFTER`), so
 * stub-mode flows and the e2e suites see a realistic expiry and no fetch
 * failure. `addresses` maps a host name to what it resolves to. The guard is
 * the real `assertPublicHttpsUrl`, so a seeded private or mixed answer is
 * refused exactly as the HTTPS fetcher would refuse it, before anything is
 * "fetched". Tests reach the instance of a running app through
 * `app.get(METADATA_FETCHER)`.
 */
export class FakeMetadataFetcher implements MetadataFetcher {
  /** URLs that passed the guard and were answered (a document or a seeded failure), oldest first. */
  readonly fetched: string[] = [];
  readonly lookup: HostLookup = async (hostname) =>
    this.addresses.get(hostname.toLowerCase()) ?? [FAKE_PUBLIC_ADDRESS];

  private readonly addresses = new Map<string, string[]>();

  constructor(
    private readonly responses: Map<string, string | Error> = new Map(),
    addresses: Map<string, string[]> = new Map(),
  ) {
    for (const [host, list] of addresses) this.setAddresses(host, list);
  }

  /** The document `url` serves from now on. */
  setResponse(url: string, xml: string): void {
    this.responses.set(url, xml);
  }

  /** From now on a fetch of `url` throws `error` (by default what a missing document gives). */
  setFailure(url: string, error: Error = new MetadataFetchError('status')): void {
    this.responses.set(url, error);
  }

  /** What `hostname` resolves to from now on. */
  setAddresses(hostname: string, addresses: string[]): void {
    this.addresses.set(hostname.toLowerCase(), [...addresses]);
  }

  async fetchXml(url: string): Promise<string> {
    await assertPublicHttpsUrl(url, this.lookup);
    this.fetched.push(url);
    const seeded = this.responses.get(url);
    if (seeded instanceof Error) throw seeded;
    return seeded ?? SAMPLE_SAML_METADATA;
  }
}
