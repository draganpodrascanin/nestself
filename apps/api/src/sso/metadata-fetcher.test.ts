/**
 * The metadata fetcher's SSRF guard and transport limits (spec 5.8): https
 * only, every resolved address public, no redirects, 5 s, 1 MiB. The HTTPS
 * fetcher runs against a stubbed `fetch` and lookup, so nothing here touches
 * the network; the one system lookup asks for `localhost` (the hosts file).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_SAML_METADATA } from '../identity/saml-metadata.fixture.js';
import {
  FAKE_PUBLIC_ADDRESS,
  FakeMetadataFetcher,
  HttpsMetadataFetcher,
  METADATA_FETCH_TIMEOUT_MS,
  METADATA_MAX_BYTES,
  MetadataFetchError,
  MetadataUrlError,
  assertPublicHttpsUrl,
  metadataFailureLabel,
  systemLookup,
  type HostLookup,
} from './metadata-fetcher.js';
import { isPublicAddress } from './public-address.js';

const URL_OK = 'https://idp.acme.example/metadata';

/** A lookup that answers every host with the given addresses and records what it was asked. */
function lookupAnswering(...addresses: string[]) {
  return vi.fn<HostLookup>(async () => addresses);
}

type FetchStub = (url: string, init: RequestInit) => Response | Promise<Response>;

function stubFetch(respond: FetchStub) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => respond(String(input), init ?? {}));
  return { fn, fetch: fn as unknown as typeof fetch };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err,
  );
}

/** A body that never ends unless the reader cancels it; counts the chunks handed out. */
function endlessBody(chunkBytes = 64 * 1024) {
  const chunk = new Uint8Array(chunkBytes).fill(0x41);
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('assertPublicHttpsUrl', () => {
  it.each(['http://idp.acme.example/metadata', 'ftp://idp.acme.example/metadata', 'file:///etc/passwd', 'not a url'])(
    'refuses %s with reason scheme, before any lookup',
    async (url) => {
      const lookup = lookupAnswering(FAKE_PUBLIC_ADDRESS);
      const err = await rejection(assertPublicHttpsUrl(url, lookup));
      expect(err).toBeInstanceOf(MetadataUrlError);
      expect(err).toMatchObject({ name: 'MetadataUrlError', reason: 'scheme' });
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('refuses credentials in the URL with reason host', async () => {
    const lookup = lookupAnswering(FAKE_PUBLIC_ADDRESS);
    await expect(assertPublicHttpsUrl('https://user:pass@idp.acme.example/metadata', lookup)).rejects.toMatchObject({
      reason: 'host',
    });
    await expect(assertPublicHttpsUrl('https://user@idp.acme.example/metadata', lookup)).rejects.toMatchObject({
      reason: 'host',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    'https://10.0.0.1/metadata',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/metadata',
    'https://[::ffff:10.0.0.1]/metadata',
    'https://[fd00::1]:8443/metadata',
    // The URL parser turns these into 127.0.0.1.
    'https://2130706433/metadata',
    'https://0x7f.1/metadata',
  ])('refuses the non-public address literal in %s without a lookup', async (url) => {
    const lookup = lookupAnswering(FAKE_PUBLIC_ADDRESS);
    await expect(assertPublicHttpsUrl(url, lookup)).rejects.toMatchObject({ reason: 'private_address' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a public address literal without a lookup', async () => {
    const lookup = lookupAnswering('10.0.0.1');
    await expect(assertPublicHttpsUrl('https://203.0.113.10/metadata', lookup)).resolves.toBeUndefined();
    await expect(assertPublicHttpsUrl('https://[2001:db8::1]/metadata', lookup)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to a public and a private address (Review Focus 4)', async () => {
    const err = await rejection(assertPublicHttpsUrl(URL_OK, lookupAnswering('203.0.113.10', '10.0.0.1')));
    expect(err).toBeInstanceOf(MetadataUrlError);
    expect(err).toMatchObject({ reason: 'private_address' });
    await expect(assertPublicHttpsUrl(URL_OK, lookupAnswering('2001:db8::1', 'fe80::1'))).rejects.toMatchObject({
      reason: 'private_address',
    });
  });

  it('refuses a host that does not resolve, or resolves to nothing, with reason host', async () => {
    const failing = vi.fn<HostLookup>(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND idp.acme.example'), { code: 'ENOTFOUND' });
    });
    await expect(assertPublicHttpsUrl(URL_OK, failing)).rejects.toMatchObject({ reason: 'host' });
    await expect(assertPublicHttpsUrl(URL_OK, lookupAnswering())).rejects.toMatchObject({ reason: 'host' });
  });

  it('accepts a host whose every address is public, asking the lookup for the bare host name', async () => {
    const lookup = lookupAnswering('203.0.113.10', '2001:db8::1');
    await expect(assertPublicHttpsUrl('https://IDP.Acme.example:8443/metadata?tenant=a', lookup)).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('idp.acme.example');
  });
});

describe('HttpsMetadataFetcher', () => {
  it('returns the document of a public https URL, fetched without following redirects or sending credentials', async () => {
    const { fn, fetch } = stubFetch(() => new Response(SAMPLE_SAML_METADATA, { status: 200 }));
    const lookup = lookupAnswering(FAKE_PUBLIC_ADDRESS);
    const fetcher = new HttpsMetadataFetcher({ lookup, fetch });

    await expect(fetcher.fetchXml(URL_OK)).resolves.toBe(SAMPLE_SAML_METADATA);

    expect(lookup).toHaveBeenCalledWith('idp.acme.example');
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(URL_OK);
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init!.headers);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
    expect(fetcher.lookup).toBe(lookup);
  });

  it('refuses an http URL before any request', async () => {
    const { fn, fetch } = stubFetch(() => new Response('<x/>'));
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    await expect(fetcher.fetchXml('http://idp.acme.example/metadata')).rejects.toMatchObject({
      name: 'MetadataUrlError',
      reason: 'scheme',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to a public and a private address before any request (Review Focus 4)', async () => {
    const { fn, fetch } = stubFetch(() => new Response(SAMPLE_SAML_METADATA));
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering('203.0.113.10', '10.0.0.1'), fetch });
    const err = await rejection(fetcher.fetchXml(URL_OK));
    expect(err).toBeInstanceOf(MetadataUrlError);
    expect(err).toMatchObject({ reason: 'private_address' });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])('treats a %i as a failure: metadata URLs must be direct', async (status) => {
    const { fn, fetch } = stubFetch(
      () => new Response(null, { status, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }),
    );
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    const err = await rejection(fetcher.fetchXml(URL_OK));
    expect(err).toBeInstanceOf(MetadataFetchError);
    expect(err).toMatchObject({ name: 'MetadataFetchError', reason: 'redirect' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats a status outside 2xx as a failure', async () => {
    const { fetch } = stubFetch(() => new Response('not here', { status: 404 }));
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    await expect(fetcher.fetchXml(URL_OK)).rejects.toMatchObject({ reason: 'status' });
  });

  it('reports a transport failure as network', async () => {
    const { fetch } = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    await expect(fetcher.fetchXml(URL_OK)).rejects.toMatchObject({ name: 'MetadataFetchError', reason: 'network' });
  });

  it('stops reading a body past 1 MiB while it streams', async () => {
    const { stream, state } = endlessBody();
    const { fetch } = stubFetch(() => new Response(stream));
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });

    const err = await rejection(fetcher.fetchXml(URL_OK));

    expect(err).toBeInstanceOf(MetadataFetchError);
    expect(err).toMatchObject({ reason: 'too_large' });
    expect(state.cancelled).toBe(true);
    // 16 chunks of 64 KiB make exactly 1 MiB; the 17th crosses the cap (plus at most one queued ahead).
    expect(state.pulls).toBeGreaterThanOrEqual(17);
    expect(state.pulls).toBeLessThanOrEqual(18);
  });

  it('refuses a declared Content-Length over 1 MiB', async () => {
    const { fetch } = stubFetch(
      () => new Response('<x/>', { headers: { 'content-length': String(METADATA_MAX_BYTES + 1) } }),
    );
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    await expect(fetcher.fetchXml(URL_OK)).rejects.toMatchObject({ reason: 'too_large' });
  });

  it('accepts a body of exactly 1 MiB', async () => {
    const { fetch } = stubFetch(() => new Response(new Uint8Array(METADATA_MAX_BYTES).fill(0x20)));
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    await expect(fetcher.fetchXml(URL_OK)).resolves.toHaveLength(METADATA_MAX_BYTES);
  });

  it('gives up on a request after 5 seconds', async () => {
    vi.useFakeTimers();
    const { fn, fetch } = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
        }),
    );
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    let settled = false;
    const outcome = fetcher.fetchXml(URL_OK).then(
      () => null,
      (err: unknown) => err,
    );
    void outcome.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(METADATA_FETCH_TIMEOUT_MS - 1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const err = await outcome;
    expect(METADATA_FETCH_TIMEOUT_MS).toBe(5_000);
    expect(err).toBeInstanceOf(MetadataFetchError);
    expect(err).toMatchObject({ reason: 'timeout' });
  });

  it('counts a lookup that hangs against the same 5 seconds and requests nothing', async () => {
    vi.useFakeTimers();
    const { fn, fetch } = stubFetch(() => new Response(SAMPLE_SAML_METADATA));
    const hanging = vi.fn<HostLookup>(() => new Promise<string[]>(() => undefined));
    const fetcher = new HttpsMetadataFetcher({ lookup: hanging, fetch });
    const outcome = fetcher.fetchXml(URL_OK).then(
      () => null,
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(METADATA_FETCH_TIMEOUT_MS);

    expect(await outcome).toMatchObject({ name: 'MetadataFetchError', reason: 'timeout' });
    expect(hanging).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('gives up on a body that stalls, within the same 5 seconds', async () => {
    vi.useFakeTimers();
    const { fetch } = stubFetch((_url, init) => {
      // Like fetch itself: an abort errors the body stream.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<md:EntityDescriptor>'));
          init.signal!.addEventListener('abort', () =>
            controller.error(new DOMException('This operation was aborted', 'AbortError')),
          );
        },
      });
      return new Response(body);
    });
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch });
    const outcome = fetcher.fetchXml(URL_OK).then(
      () => null,
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(METADATA_FETCH_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ name: 'MetadataFetchError', reason: 'timeout' });
  });

  it('by default resolves with the system resolver: localhost answers loopback addresses and is refused', async () => {
    const addresses = await systemLookup('localhost');
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.some(isPublicAddress)).toBe(false);

    const { fn, fetch } = stubFetch(() => new Response(SAMPLE_SAML_METADATA));
    const fetcher = new HttpsMetadataFetcher({ fetch });
    expect(fetcher.lookup).toBe(systemLookup);
    await expect(fetcher.fetchXml('https://localhost/metadata')).rejects.toMatchObject({ reason: 'private_address' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('honours a smaller size cap when given', async () => {
    const { fetch } = stubFetch(() => new Response('0123456789'));
    const fetcher = new HttpsMetadataFetcher({ lookup: lookupAnswering(FAKE_PUBLIC_ADDRESS), fetch, maxBytes: 9 });
    await expect(fetcher.fetchXml(URL_OK)).rejects.toMatchObject({ reason: 'too_large' });
  });
});

describe('FakeMetadataFetcher', () => {
  it('serves a seeded document and answers an unseeded host with a public address, without DNS', async () => {
    const fetcher = new FakeMetadataFetcher(new Map([[URL_OK, SAMPLE_SAML_METADATA]]));
    // `.example` names never resolve: a DNS lookup would refuse this host.
    await expect(fetcher.lookup('idp.nowhere.example')).resolves.toEqual([FAKE_PUBLIC_ADDRESS]);
    await expect(fetcher.fetchXml(URL_OK)).resolves.toBe(SAMPLE_SAML_METADATA);
    expect(fetcher.fetched).toEqual([URL_OK]);
  });

  it('applies the same guard as the HTTPS fetcher to seeded private and mixed answers, before serving', async () => {
    const mixed = 'https://idp.mixed.example/metadata';
    const fetcher = new FakeMetadataFetcher(new Map([[mixed, SAMPLE_SAML_METADATA]]));
    fetcher.setAddresses('IDP.Mixed.example', ['203.0.113.10', '10.0.0.1']);

    await expect(fetcher.lookup('idp.mixed.example')).resolves.toEqual(['203.0.113.10', '10.0.0.1']);
    await expect(fetcher.fetchXml(mixed)).rejects.toMatchObject({ name: 'MetadataUrlError', reason: 'private_address' });
    await expect(fetcher.fetchXml('http://idp.acme.example/metadata')).rejects.toMatchObject({ reason: 'scheme' });
    expect(fetcher.fetched).toEqual([]);
  });

  it('fails for a URL it does not serve, as a missing document would', async () => {
    const fetcher = new FakeMetadataFetcher(new Map());
    await expect(fetcher.fetchXml(URL_OK)).rejects.toMatchObject({ name: 'MetadataFetchError', reason: 'status' });
    fetcher.setResponse(URL_OK, '<md:EntityDescriptor/>');
    await expect(fetcher.fetchXml(URL_OK)).resolves.toBe('<md:EntityDescriptor/>');
    expect(fetcher.fetched).toEqual([URL_OK, URL_OK]);
  });
});

describe('metadataFailureLabel', () => {
  it('names the error and, for this module, its reason; never the URL, its query or the body', () => {
    expect(metadataFailureLabel(new MetadataUrlError('private_address'))).toBe('MetadataUrlError: private_address');
    expect(metadataFailureLabel(new MetadataFetchError('timeout'))).toBe('MetadataFetchError: timeout');
    const leaky = new TypeError('fetch failed: https://idp.acme.example/metadata?tenant=secret <md:EntityDescriptor>');
    expect(metadataFailureLabel(leaky)).toBe('TypeError');
    expect(metadataFailureLabel('a thrown string')).toBe('unknown error');
  });

  it('keeps URLs out of the error messages themselves', () => {
    for (const reason of ['scheme', 'host', 'private_address'] as const) {
      expect(new MetadataUrlError(reason).message).not.toMatch(/https?:\/\/|\.example/);
    }
    for (const reason of ['redirect', 'status', 'too_large', 'timeout', 'network'] as const) {
      expect(new MetadataFetchError(reason).message).not.toMatch(/https?:\/\/|\.example/);
    }
  });
});
