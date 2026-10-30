import { describe, it, expect } from 'vitest';
import { certificateExpiryFromMetadata } from './saml-metadata.js';
import {
  ENCRYPTION_CERT_B64,
  ENCRYPTION_CERT_NOT_AFTER,
  SAMPLE_SAML_METADATA,
  SIGNING_CERT_B64,
  SIGNING_CERT_NOT_AFTER,
} from './saml-metadata.fixture.js';

describe('certificateExpiryFromMetadata', () => {
  it('reads notAfter of the signing certificate and ignores the encryption one', () => {
    expect(certificateExpiryFromMetadata(SAMPLE_SAML_METADATA)).toEqual(SIGNING_CERT_NOT_AFTER);
  });

  it('takes the earliest expiry when several certificates sign', () => {
    const xml = `<EntityDescriptor>
      <KeyDescriptor use="signing"><X509Certificate>${SIGNING_CERT_B64}</X509Certificate></KeyDescriptor>
      <KeyDescriptor><X509Certificate>${ENCRYPTION_CERT_B64}</X509Certificate></KeyDescriptor>
    </EntityDescriptor>`;
    expect(certificateExpiryFromMetadata(xml)).toEqual(ENCRYPTION_CERT_NOT_AFTER);
  });

  it('falls back to every certificate when there is no KeyDescriptor', () => {
    const xml = `<X509Certificate>${SIGNING_CERT_B64}</X509Certificate>`;
    expect(certificateExpiryFromMetadata(xml)).toEqual(SIGNING_CERT_NOT_AFTER);
  });

  it('returns null for missing, empty or unparsable metadata', () => {
    expect(certificateExpiryFromMetadata(undefined)).toBeNull();
    expect(certificateExpiryFromMetadata('')).toBeNull();
    expect(certificateExpiryFromMetadata('<KeyDescriptor><X509Certificate>bm90LWEtY2VydA==</X509Certificate></KeyDescriptor>')).toBeNull();
  });
});
