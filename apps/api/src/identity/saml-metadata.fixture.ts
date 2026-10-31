/**
 * Fixtures for the stub-mode fake and the tests: two self-signed
 * certificates (generated with openssl for this purpose only, private keys
 * discarded) and SAML metadata using them. The stub-mode
 * `FakeMetadataFetcher` (`sso/fake-metadata-fetcher.ts`) serves
 * `SAMPLE_SAML_METADATA` for every metadata URL nothing seeded; the
 * production fetcher never imports this file. Nothing is signed with these
 * certificates and nothing trusts them.
 */

/** CN=idp.acme.example, notAfter 2027-11-29T07:18:28Z. */
export const SIGNING_CERT_B64 = [
  'MIIC9jCCAd6gAwIBAgIUP0wcu4ExlO0QZR6J3pblrScyR80wDQYJKoZIhvcNAQEL',
  'BQAwGzEZMBcGA1UEAwwQaWRwLmFjbWUuZXhhbXBsZTAeFw0yNjEwMjUwNzE4Mjha',
  'Fw0yNzExMjkwNzE4MjhaMBsxGTAXBgNVBAMMEGlkcC5hY21lLmV4YW1wbGUwggEi',
  'MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDEt9JEtUB+4SFDy+kGgdo/qzrp',
  'MAUHap554z/UYcyET6E0bbDthP47uoZkuOJR3uJ4RFjpUm+NZ8m2jOLCPOlzXlEd',
  'NYPJOoSBRt2xT13tfjIr836DaOtWWuHyvnVT/Cen7fYe0pLM9GSj0A9yu9VaOUYj',
  'AT+TUMOlYdh9uaVbH0DVFp8z8PJSBMWYMHJKx9ymZAijjH8euTMsr8VVLxn1ndoj',
  'IzJOS4zu2Mcn1qcLiV3VANbJCZyrA8LpxltZ1TnQJ5+TNn2R7ITAmI8UOQlt9rA9',
  'V2grwEwb8vylMkyfKoVj4D5iAwEUiy6LnZZju28s0AqbLghroE8liCJwnzrxAgMB',
  'AAGjMjAwMB0GA1UdDgQWBBS1EqAnSiAMwAheJgWNGQ+S3r23cjAPBgNVHRMBAf8E',
  'BTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBgEoieLiCAIfHm4Y4eLIotBrKwAhgb',
  'M0QAi2HsxekplsFOvs+3cv9TMfC1NfzVb8lQ1Wa6bkngNhg7EoxENdkZPu1zJ8xk',
  'tUEv7J8nI6tU+H0H4oq7/ec0ctrInzdGGWkI4jHGZrjZp4BcPiHClAc1m++OFhIE',
  'pFkW5xFgKKlp1ili7zVDytIheONHB5/ZAnXQjhSYGtGBFfTZo/6H6yggw3zLgDbz',
  '24to7+vwtLIT6FcWZke2HUnyzEh3FYP90g46Dvkqs3cFP5QiZkxDgnDY/ou155IA',
  '8uommCEr3WPSy31TcVs5O2/7XPZoLS8eEXw8Wled2nqrtP54zw4YVC4P',
].join('');

/** CN=enc.acme.example, notAfter 2026-11-24T07:18:28Z. */
export const ENCRYPTION_CERT_B64 = [
  'MIIC9jCCAd6gAwIBAgIUafDdFjVF2z6IME9UYQULtT3MgG0wDQYJKoZIhvcNAQEL',
  'BQAwGzEZMBcGA1UEAwwQZW5jLmFjbWUuZXhhbXBsZTAeFw0yNjEwMjUwNzE4Mjha',
  'Fw0yNjExMjQwNzE4MjhaMBsxGTAXBgNVBAMMEGVuYy5hY21lLmV4YW1wbGUwggEi',
  'MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC0vzleSIO83M/WHNW2IhUXNHU3',
  'yju1m+gWviCjbmhJVxC0R2E6FS2zDhYfxgW+uLAd8zFx9i5KT+xSpms0ds2XX4tE',
  'dLvl3ce8k5SadQJ2t8Yx2/1M1ew0Y+TUIOiUERicsM8qlyhKhHujZGYf/4QS0Gt7',
  'SORkf2BoZdd+SZ0X0H6T9Iquz0P5SjjPCHmX/0iRVq6g2pnTVF+J9K0lQuSM9oMP',
  'aNWEkiRjZWVVFDyvqBfJQz4n4U0kZmvALJU66qGRZuCsJhE4BYidRGDc/L2ocFbw',
  'QAeRO+Q+baZ1sjx3DFsOgmR2o9r9jHmAZgapJej8yus+sa0qKYLRC5SgigrXAgMB',
  'AAGjMjAwMB0GA1UdDgQWBBQanZ3IDZYdQ+BtmOAn5YMulKWs9TAPBgNVHRMBAf8E',
  'BTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQCCmRfQyst08zHlLW81NGjcglWe7BEA',
  'ITeMHggqZqESet/UKeMTNUjdIpKXIa/TYohXrW6Ud2fVmyZKl10KQH5BxNYg3o3B',
  'cTRWduMQpE0DmpLSeIogFvhXszSnCIw7D1FUwtlLKhRD55S1YXp8nOHKX+FcdA2y',
  'rG8lf0ex6bwaq6m4UrM/d8Xay3tJBGfBMjZa7yPadQUXZT2dVi5TbBDhJecgKMm9',
  'ghWr36CSI7Pc1698QNoVQnngKEiLSQdDkmrsm4WK3hcNd7DMLj0rFyIvi0hcdXNG',
  'dz+ppm/A0Xrae7cDXNpzwE1wcgDddgTmDHUATz0Dpql6oJIklYiH70vR',
].join('');

export const SIGNING_CERT_NOT_AFTER = new Date('2027-11-29T07:18:28Z');
export const ENCRYPTION_CERT_NOT_AFTER = new Date('2026-11-24T07:18:28Z');

export const SAMPLE_SAML_METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="https://idp.acme.example">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>
${SIGNING_CERT_B64}
      </ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="encryption">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>${ENCRYPTION_CERT_B64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.acme.example/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
