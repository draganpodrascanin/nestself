import type { SsoConnectionResponse } from '@nestself/contracts';

/** A sample SSO connection; `sample: true` is the fixture marker, not part of the API shape. */
export type SampleSsoConnection = SsoConnectionResponse & { sample: true };

/** Fictional service-provider values; no user pool has this id. */
const SAMPLE_SP_METADATA = {
  entityId: 'urn:amazon:cognito:sp:eu-central-1_SAMPLE0000',
  acsUrl: 'https://sample-auth.example/saml2/idpresponse',
};

/**
 * SSO connections shown on the admin SSO page in sample mode: an active SAML
 * connection with one verified domain, and a draft OIDC connection with a
 * pending one. Both belong to the sample organization; the identity
 * providers, domains and DNS records are fictional (`.example` is reserved)
 * and nothing was registered, tested or verified.
 */
export const SAMPLE_SSO_CONNECTIONS: SampleSsoConnection[] = [
  {
    id: 'sso_sample_saml',
    orgId: 'org_sample',
    protocol: 'SAML',
    cognitoProviderName: 'org-example-saml',
    status: 'ACTIVE',
    metadataUrl: 'https://idp.sample-employer.example/saml/metadata',
    oidcIssuer: null,
    oidcClientId: null,
    idpInitiatedAllowed: false,
    jitProvisioning: false,
    oidcEmailVerifiedClaimRequired: true,
    defaultOrgUnitId: null,
    certificateExpiresAt: '2027-06-30T00:00:00.000Z',
    lastTestedAt: '2026-10-20T09:30:00.000Z',
    domains: [
      {
        id: 'sd_sample_verified',
        domain: 'sample-employer.example',
        verifiedAt: '2026-10-19T14:00:00.000Z',
        txtRecordName: '_nestself-verify.sample-employer.example',
        txtRecordValue: 'nestself-domain-verification=sample0000000000000000000000000001',
      },
    ],
    spMetadata: SAMPLE_SP_METADATA,
    sample: true,
  },
  {
    id: 'sso_sample_oidc',
    orgId: 'org_sample',
    protocol: 'OIDC',
    cognitoProviderName: 'org-exmpl-oidc',
    status: 'DRAFT',
    metadataUrl: null,
    oidcIssuer: 'https://login.sample-employer.example',
    oidcClientId: 'sample-client-id',
    idpInitiatedAllowed: false,
    jitProvisioning: true,
    oidcEmailVerifiedClaimRequired: true,
    defaultOrgUnitId: null,
    certificateExpiresAt: null,
    lastTestedAt: null,
    domains: [
      {
        id: 'sd_sample_pending',
        domain: 'staff.sample-employer.example',
        verifiedAt: null,
        txtRecordName: '_nestself-verify.staff.sample-employer.example',
        txtRecordValue: 'nestself-domain-verification=sample0000000000000000000000000002',
      },
    ],
    spMetadata: SAMPLE_SP_METADATA,
    sample: true,
  },
];
