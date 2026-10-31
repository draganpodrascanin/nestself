/**
 * The stub-mode and test metadata fetcher: the fixture for a URL nothing
 * seeded, seeded documents and failures, host names from a table (never
 * DNS), and the real SSRF guard in front of it all.
 */
import { describe, expect, it } from 'vitest';
import { SAMPLE_SAML_METADATA } from '../identity/saml-metadata.fixture.js';
import { FAKE_PUBLIC_ADDRESS, FakeMetadataFetcher } from './fake-metadata-fetcher.js';
import { HostLookupUnavailableError, MetadataFetchError } from './metadata-fetcher.js';

const URL_OK = 'https://idp.acme.example/metadata';

describe('FakeMetadataFetcher', () => {
  it('serves the fixture metadata for a URL nothing seeded, on a host that resolves without DNS', async () => {
    const fetcher = new FakeMetadataFetcher();
    // `.example` names never resolve: a DNS lookup would refuse this host.
    await expect(fetcher.lookup('idp.nowhere.example')).resolves.toEqual([FAKE_PUBLIC_ADDRESS]);
    await expect(fetcher.fetchXml('https://idp.nowhere.example/saml/metadata?tenant=a')).resolves.toBe(SAMPLE_SAML_METADATA);
    expect(fetcher.fetched).toEqual(['https://idp.nowhere.example/saml/metadata?tenant=a']);
  });

  it('serves a seeded document instead', async () => {
    const fetcher = new FakeMetadataFetcher(new Map([[URL_OK, '<md:EntityDescriptor/>']]));
    await expect(fetcher.fetchXml(URL_OK)).resolves.toBe('<md:EntityDescriptor/>');
    fetcher.setResponse(URL_OK, '<md:EntityDescriptor>rotated</md:EntityDescriptor>');
    await expect(fetcher.fetchXml(URL_OK)).resolves.toBe('<md:EntityDescriptor>rotated</md:EntityDescriptor>');
  });

  it('throws a seeded failure: a missing document by default, or the error given', async () => {
    const fetcher = new FakeMetadataFetcher();
    fetcher.setFailure(URL_OK);
    await expect(fetcher.fetchXml(URL_OK)).rejects.toMatchObject({ name: 'MetadataFetchError', reason: 'status' });

    const timeout = new MetadataFetchError('timeout');
    fetcher.setFailure(URL_OK, timeout);
    await expect(fetcher.fetchXml(URL_OK)).rejects.toBe(timeout);

    const redirect = new MetadataFetchError('redirect');
    const seeded = new FakeMetadataFetcher(new Map<string, string | Error>([[URL_OK, redirect]]));
    await expect(seeded.fetchXml(URL_OK)).rejects.toBe(redirect);

    // A failure seeded for one URL leaves the others answering the fixture.
    await expect(fetcher.fetchXml('https://idp.acme.example/other')).resolves.toBe(SAMPLE_SAML_METADATA);
    expect(fetcher.fetched).toEqual([URL_OK, URL_OK, 'https://idp.acme.example/other']);
  });

  it('applies the same guard as the HTTPS fetcher to seeded private and mixed answers, before serving', async () => {
    const mixed = 'https://idp.mixed.example/metadata';
    const fetcher = new FakeMetadataFetcher();
    fetcher.setAddresses('IDP.Mixed.example', ['203.0.113.10', '10.0.0.1']);
    fetcher.setAddresses('idp.internal.example', ['10.0.0.5']);

    await expect(fetcher.lookup('idp.mixed.example')).resolves.toEqual(['203.0.113.10', '10.0.0.1']);
    await expect(fetcher.fetchXml(mixed)).rejects.toMatchObject({ name: 'MetadataUrlError', reason: 'private_address' });
    await expect(fetcher.fetchXml('https://idp.internal.example/metadata')).rejects.toMatchObject({
      reason: 'private_address',
    });
    await expect(fetcher.fetchXml('http://idp.acme.example/metadata')).rejects.toMatchObject({ reason: 'scheme' });
    expect(fetcher.fetched).toEqual([]);
  });

  it('takes the address table in the constructor too', async () => {
    const fetcher = new FakeMetadataFetcher(new Map(), new Map([['IDP.Acme.example', ['127.0.0.1']]]));
    await expect(fetcher.fetchXml(URL_OK)).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('a seeded resolver failure reaches the guard as the resolver would report it', async () => {
    const fetcher = new FakeMetadataFetcher();
    fetcher.setLookupFailure('IDP.Gone.example', Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    fetcher.setLookupFailure('idp.slow.example', Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }));

    await expect(fetcher.fetchXml('https://idp.gone.example/metadata')).rejects.toMatchObject({
      name: 'MetadataUrlError',
      reason: 'host',
    });
    const err = await fetcher.fetchXml('https://idp.slow.example/metadata').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HostLookupUnavailableError);
    expect(fetcher.fetched).toEqual([]);
  });
});
