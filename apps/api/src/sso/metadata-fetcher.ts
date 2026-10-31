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
 * A host the resolver cannot answer for in time (`EAI_AGAIN`, `ETIMEOUT`,
 * `ETIMEDOUT`, or no answer within 5 s) says nothing about the URL: that is
 * a {@link HostLookupUnavailableError} (the SSO service answers 503), while a
 * name that does not exist is a {@link MetadataUrlError} `host` (422).
 *
 * Errors carry a fixed reason and a message without the URL; log them with
 * `metadataFailureLabel`, never with the URL (its query may hold a tenant
 * identifier) or the body.
 *
 * The stub-mode and test adapter is `FakeMetadataFetcher`
 * (`fake-metadata-fetcher.ts`).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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
  /**
   * The document at `url`; rejects with {@link MetadataUrlError},
   * {@link HostLookupUnavailableError} or {@link MetadataFetchError}.
   */
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

/**
 * The resolver did not answer for the host (a temporary failure, a timeout,
 * or nothing within the 5-second deadline): neither a refusal nor an
 * acceptance of the URL. Worth another try later.
 */
export class HostLookupUnavailableError extends Error {
  constructor() {
    super('The host name could not be resolved in time; try again later');
    this.name = 'HostLookupUnavailableError';
  }
}

/** Resolver codes for a resolver that did not answer, as opposed to a name that does not exist. */
const RESOLVER_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['EAI_AGAIN', 'ETIMEOUT', 'ETIMEDOUT']);

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
 * addresses only. Rejects with a {@link MetadataUrlError} otherwise (`host`
 * for a name that does not resolve: `ENOTFOUND`, `ENODATA`, `ENOTIMP`, no
 * address), and with a {@link HostLookupUnavailableError} when the resolver
 * fails temporarily or takes longer than `METADATA_FETCH_TIMEOUT_MS`.
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
    addresses = await lookupWithin(lookup, host, METADATA_FETCH_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof HostLookupUnavailableError) throw err;
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && RESOLVER_UNAVAILABLE_CODES.has(code)) throw new HostLookupUnavailableError();
    throw new MetadataUrlError('host');
  }
  if (addresses.length === 0) throw new MetadataUrlError('host');
  if (!addresses.every(isPublicAddress)) throw new MetadataUrlError('private_address');
}

/** `lookup(host)`, or a {@link HostLookupUnavailableError} when it has not answered within `ms`. */
function lookupWithin(lookup: HostLookup, host: string, ms: number): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HostLookupUnavailableError()), ms);
    Promise.resolve()
      .then(() => lookup(host))
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
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
