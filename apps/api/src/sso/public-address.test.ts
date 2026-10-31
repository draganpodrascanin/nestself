/**
 * isPublicAddress: the address classification behind the metadata fetcher's
 * SSRF guard (`metadata-fetcher.ts`). The first two lists are the plan's test
 * vectors; the rest pin the edges of each refused range and the IPv6 forms
 * that carry an IPv4 address.
 */
import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './public-address.js';

describe('isPublicAddress', () => {
  it.each([
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('%s is not public', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['203.0.113.10', '2001:db8::1'])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    ['0.255.255.255', 'this network (0.0.0.0/8)'],
    ['10.255.255.255', 'the top of 10.0.0.0/8'],
    ['100.127.255.255', 'the top of the shared address space 100.64.0.0/10'],
    ['127.255.255.254', 'loopback beyond 127.0.0.1'],
    ['172.31.255.255', 'the top of 172.16.0.0/12'],
    ['192.0.0.8', 'IETF protocol assignments (192.0.0.0/24)'],
    ['192.168.255.255', 'the top of 192.168.0.0/16'],
    ['198.18.0.1', 'benchmarking (198.18.0.0/15)'],
    ['198.19.255.255', 'the top of 198.18.0.0/15'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'the top of multicast'],
    ['240.0.0.1', 'reserved (240.0.0.0/4)'],
    ['255.255.255.255', 'the limited broadcast'],
    ['169.254.170.2', 'the ECS task metadata endpoint (link-local)'],
    ['fd00:ec2::254', 'the EC2 instance metadata endpoint over IPv6 (unique local)'],
    ['::', 'the IPv6 unspecified address'],
    ['::0.0.0.1', 'an IPv4-compatible address (deprecated)'],
    ['::203.0.113.10', 'an IPv4-compatible address of a public one (deprecated, never routed)'],
    ['fd12:3456::1', 'unique local (fc00::/7)'],
    ['febf::1', 'the top of link-local fe80::/10'],
    ['fec0::1', 'site-local (deprecated)'],
    ['ff02::1', 'IPv6 multicast'],
    ['100::1', 'the IPv6 discard prefix'],
    ['::ffff:169.254.169.254', 'the cloud metadata endpoint, IPv4-mapped'],
    ['::ffff:a9fe:a9fe', 'the same, IPv4-mapped in hex'],
    ['::FFFF:7F00:1', '127.0.0.1, IPv4-mapped in upper case'],
    ['64:ff9b::a00:1', '10.0.0.1 through the NAT64 prefix'],
    ['64:ff9b::169.254.169.254', 'the metadata endpoint through NAT64, dotted'],
    ['64:ff9b:1::cb00:710a', 'the local-use NAT64 prefix'],
    ['2002:a00:1::1', '10.0.0.1 through 6to4'],
    ['2001::1', 'Teredo (2001::/32)'],
    ['2001:2::1', 'benchmarking (2001:2::/48)'],
    ['fe80::1%en0', 'a link-local address with a zone'],
    ['010.0.0.1', 'a dotted quad with a leading zero (not an address)'],
    ['idp.acme.example', 'a host name'],
    ['', 'an empty string'],
  ])('%s is not public: %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ['1.1.1.1', 'a public IPv4 address'],
    ['9.255.255.255', 'just below 10.0.0.0/8'],
    ['11.0.0.0', 'just above 10.0.0.0/8'],
    ['100.63.255.255', 'just below the shared address space'],
    ['100.128.0.0', 'just above the shared address space'],
    ['172.15.255.255', 'just below 172.16.0.0/12'],
    ['172.32.0.0', 'just above 172.16.0.0/12'],
    ['198.17.255.255', 'just below 198.18.0.0/15'],
    ['198.20.0.0', 'just above 198.18.0.0/15'],
    ['223.255.255.255', 'just below multicast'],
    ['192.0.2.1', 'documentation (TEST-NET-1), routed nowhere'],
    ['2606:4700:4700::1111', 'a public IPv6 address'],
    ['2001:DB8::1', 'documentation, upper case'],
    ['::ffff:203.0.113.10', 'a public IPv4 address, IPv4-mapped'],
    ['64:ff9b::cb00:710a', '203.0.113.10 through NAT64'],
    ['2002:cb00:710a::1', '203.0.113.10 through 6to4'],
  ])('%s is public: %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});
