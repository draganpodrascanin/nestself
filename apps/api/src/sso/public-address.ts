/**
 * Whether an IP address is a public unicast address: the only kind the API
 * may connect to when it fetches a tenant-supplied URL (`metadata-fetcher.ts`,
 * spec 5.8). Pure classification, no I/O.
 *
 * Refused IPv4 ranges: "this network" 0.0.0.0/8 (with the unspecified
 * 0.0.0.0), private 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16, the shared
 * carrier-grade NAT space 100.64.0.0/10, loopback 127.0.0.0/8, link-local
 * 169.254.0.0/16 (with the cloud metadata endpoint 169.254.169.254), IETF
 * protocol assignments 192.0.0.0/24, benchmarking 198.18.0.0/15, multicast
 * 224.0.0.0/4 and the reserved 240.0.0.0/4 (with the broadcast address).
 *
 * IPv6: an address that carries an IPv4 address is judged by that address:
 * IPv4-mapped `::ffff:0:0/96`, the NAT64 prefix `64:ff9b::/96` and 6to4
 * `2002::/16`. Otherwise only global unicast `2000::/3` is public, minus the
 * IETF protocol assignments `2001::/23` (Teredo, benchmarking, ORCHID). That
 * refuses the unspecified and loopback addresses, the deprecated
 * IPv4-compatible `::/96`, unique local `fc00::/7`, link-local `fe80::/10`,
 * site-local `fec0::/10`, multicast `ff00::/8`, the discard prefix `100::/64`
 * and the local-use NAT64 prefix `64:ff9b:1::/48`. An address with a zone
 * (`fe80::1%en0`) is always link-scoped, so refused.
 *
 * The documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24,
 * `2001:db8::/32`) count as public: nothing routes them, so they reach no
 * internal service, and the tests use them as stand-ins for public hosts.
 */
import { isIPv4, isIPv6 } from 'node:net';

/** IPv4 ranges (network, prefix length) that are not public unicast. */
const NON_PUBLIC_IPV4: ReadonlyArray<readonly [network: string, prefix: number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** A dotted quad as an unsigned 32-bit number. The caller has checked it is one. */
function ipv4Number(ip: string): number {
  return ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
}

function inIpv4Range(value: number, network: string, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(value / size) === Math.floor(ipv4Number(network) / size);
}

function isPublicIpv4(value: number): boolean {
  return !NON_PUBLIC_IPV4.some(([network, prefix]) => inIpv4Range(value, network, prefix));
}

/**
 * The eight 16-bit groups of a valid IPv6 address without a zone, with `::`
 * expanded and a trailing dotted IPv4 part turned into the last two groups.
 */
function ipv6Groups(ip: string): number[] {
  let head = ip;
  const tail: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const last = ip.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = ipv4Number(last);
    tail.push(Math.floor(v4 / 0x10000), v4 % 0x10000);
    // Keep a `::` that ends right before the IPv4 part; drop a single separating colon.
    head = ip.slice(0, lastColon + 1);
    if (!head.endsWith('::')) head = head.slice(0, -1);
  }
  const groupsOf = (part: string): number[] => (part === '' ? [] : part.split(':').map((g) => parseInt(g, 16)));
  const [left, right] = head.split('::');
  if (right === undefined) return [...groupsOf(left ?? ''), ...tail];
  const before = groupsOf(left ?? '');
  const after = [...groupsOf(right), ...tail];
  return [...before, ...new Array<number>(8 - before.length - after.length).fill(0), ...after];
}

function isPublicIpv6(groups: number[]): boolean {
  const g = (i: number) => groups[i] ?? 0;
  const zeroUpTo = (end: number) => groups.slice(0, end).every((x) => x === 0);
  const lastIpv4 = g(6) * 0x10000 + g(7);
  // IPv4-mapped ::ffff:a.b.c.d
  if (zeroUpTo(5) && g(5) === 0xffff) return isPublicIpv4(lastIpv4);
  // NAT64 64:ff9b::a.b.c.d (a NAT64 gateway connects to the IPv4 address)
  if (g(0) === 0x64 && g(1) === 0xff9b && groups.slice(2, 6).every((x) => x === 0)) return isPublicIpv4(lastIpv4);
  // 6to4 2002:aabb:ccdd::/48 carries a.b.c.d in groups 1 and 2
  if (g(0) === 0x2002) return isPublicIpv4(g(1) * 0x10000 + g(2));
  // Global unicast 2000::/3 only, minus the IETF protocol assignments 2001::/23
  if ((g(0) & 0xe000) !== 0x2000) return false;
  if (g(0) === 0x2001 && g(1) < 0x0200) return false;
  return true;
}

/** True when `ip` is a public unicast IPv4 or IPv6 address; false for anything else, host names included. */
export function isPublicAddress(ip: string): boolean {
  if (isIPv4(ip)) return isPublicIpv4(ipv4Number(ip));
  if (isIPv6(ip)) return !ip.includes('%') && isPublicIpv6(ipv6Groups(ip));
  return false;
}
