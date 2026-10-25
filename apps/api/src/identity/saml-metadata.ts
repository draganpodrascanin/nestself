/**
 * Reads the signing-certificate expiry out of SAML IdP metadata.
 *
 * Only `<KeyDescriptor>` elements without `use` or with `use="signing"`
 * count: an encryption certificate expiring does not break sign-in. When the
 * metadata has no `<KeyDescriptor>` at all, every `<X509Certificate>` counts.
 * The earliest `notAfter` wins because the IdP may sign with any of them.
 *
 * @see D-12 (certificate expiry reminders)
 */
import { X509Certificate } from 'node:crypto';

const KEY_DESCRIPTOR = /<(?:[\w-]+:)?KeyDescriptor\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?KeyDescriptor>/g;
const X509 = /<(?:[\w-]+:)?X509Certificate\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?X509Certificate>/g;
const USE_ATTR = /\buse\s*=\s*["']([^"']*)["']/;

function certificatesIn(fragment: string): string[] {
  return [...fragment.matchAll(X509)].map((m) => m[1]!.replace(/\s+/g, ''));
}

function signingCertificates(xml: string): string[] {
  const descriptors = [...xml.matchAll(KEY_DESCRIPTOR)];
  if (descriptors.length === 0) return certificatesIn(xml);
  return descriptors
    .filter((d) => {
      const use = USE_ATTR.exec(d[1] ?? '')?.[1];
      return use === undefined || use === 'signing';
    })
    .flatMap((d) => certificatesIn(d[2] ?? ''));
}

function notAfter(base64Der: string): Date | null {
  try {
    const cert = new X509Certificate(Buffer.from(base64Der, 'base64'));
    const at = new Date(cert.validTo);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

/** Earliest signing-certificate expiry in the metadata, or null when none parses. */
export function certificateExpiryFromMetadata(xml: string | null | undefined): Date | null {
  if (!xml) return null;
  let earliest: Date | null = null;
  for (const der of signingCertificates(xml)) {
    const at = notAfter(der);
    if (at && (!earliest || at < earliest)) earliest = at;
  }
  return earliest;
}
