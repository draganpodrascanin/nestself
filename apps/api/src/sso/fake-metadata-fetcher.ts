/**
 * The stub-mode and test `MetadataFetcher`, as `fake-identity-provider.ts`
 * is to the Cognito adapter: `IdentityModule` provides it whenever
 * `AUTH_MODE` is not `cognito`, and tests reach the instance of a running app
 * through `app.get(METADATA_FETCHER)`.
 *
 * It never touches DNS or the network. Host names resolve from a table: a
 * host without an entry answers a public documentation address, and a test
 * seeds private or mixed answers, or a resolver failure. A URL nothing seeded
 * serves the fixture metadata `SAMPLE_SAML_METADATA` (its signing certificate
 * expires on `SIGNING_CERT_NOT_AFTER`), so stub-mode SAML connections get a
 * realistic expiry and no fetch failure; a test that needs a failure seeds
 * it. The guard is the real `assertPublicHttpsUrl`, so a URL the HTTPS
 * fetcher would refuse is refused here too, before anything is "fetched".
 */
import { SAMPLE_SAML_METADATA } from '../identity/saml-metadata.fixture.js';
import { MetadataFetchError, assertPublicHttpsUrl, type HostLookup, type MetadataFetcher } from './metadata-fetcher.js';

/** What an unseeded host resolves to: a documentation address (TEST-NET-3), public by `isPublicAddress`. */
export const FAKE_PUBLIC_ADDRESS = '203.0.113.10';

export class FakeMetadataFetcher implements MetadataFetcher {
  /** URLs that passed the guard and were answered (a document or a seeded failure), oldest first. */
  readonly fetched: string[] = [];
  readonly lookup: HostLookup = async (hostname) => {
    const answer = this.addresses.get(hostname.toLowerCase());
    if (answer instanceof Error) throw answer;
    return answer ?? [FAKE_PUBLIC_ADDRESS];
  };

  private readonly addresses = new Map<string, string[] | Error>();

  /**
   * `responses` maps a URL to the document it serves or to the error its
   * fetch throws; `addresses` maps a host name to what it resolves to.
   */
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

  /** From now on resolving `hostname` fails with `error` (give it the resolver's `code`, such as `EAI_AGAIN`). */
  setLookupFailure(hostname: string, error: Error): void {
    this.addresses.set(hostname.toLowerCase(), error);
  }

  async fetchXml(url: string): Promise<string> {
    await assertPublicHttpsUrl(url, this.lookup);
    this.fetched.push(url);
    const seeded = this.responses.get(url);
    if (seeded instanceof Error) throw seeded;
    return seeded ?? SAMPLE_SAML_METADATA;
  }
}
