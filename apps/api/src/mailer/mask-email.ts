/**
 * Address helpers for places that must not show a whole address: a masked
 * address in an API answer ("We sent a code to i***@acme.example"), the
 * recipient's domain in a log line.
 */

/**
 * `ivana@acme.example` becomes `i***@acme.example`: the first character
 * of the local part, three stars (so its length is not revealed) and the
 * domain. A one-character local part becomes `*@b.c`. Input without an `@`
 * is never echoed.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '***';
  const [first, ...rest] = email.slice(0, at);
  const local = first === undefined || rest.length === 0 ? '*' : `${first}***`;
  return `${local}@${email.slice(at + 1)}`;
}

/** What follows the last `@`; `unknown` for a string that is not an address. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? 'unknown' : email.slice(at + 1);
}
