/**
 * Test-only fixtures for the SSO screen and its dialogs: connections and
 * domains in every state, and an `OpsAdminApi` mock with the SSO routes on top
 * of the operations harness's organization routes.
 */
import { vi } from 'vitest';
import type { SsoConnectionResponse, SsoDomainResponse } from '@nestself/contracts';
import { ORG_ID, makeOpsApi } from '../organizations/ops-test-harness';

/** What `POST /ops/sso-connections/:id/test` answers: a single-use link. */
export const START_URL = 'http://localhost:4000/api/auth/sso/start?connection=org-draft-saml&surface=workspace&testNonce=abc';

export function ssoDomain(id: string, name: string, verified: boolean): SsoDomainResponse {
  return {
    id,
    domain: name,
    verifiedAt: verified ? '2026-10-20T10:00:00.000Z' : null,
    txtRecordName: `_nestself-verify.${name}`,
    txtRecordValue: `nestself-domain-verification=token-${id}`,
  };
}

/** A DRAFT SAML connection of the sample organization; override what a test needs. */
export function ssoConnection(id: string, overrides: Partial<SsoConnectionResponse> = {}): SsoConnectionResponse {
  return {
    id,
    orgId: ORG_ID,
    protocol: 'SAML',
    cognitoProviderName: `org-${id}-saml`,
    status: 'DRAFT',
    metadataUrl: 'https://idp.example.test/metadata',
    oidcIssuer: null,
    oidcClientId: null,
    idpInitiatedAllowed: false,
    jitProvisioning: false,
    oidcEmailVerifiedClaimRequired: true,
    defaultOrgUnitId: null,
    certificateExpiresAt: null,
    lastTestedAt: null,
    domains: [],
    spMetadata: { entityId: 'urn:amazon:cognito:sp:eu-central-1_TEST', acsUrl: 'https://auth.example.test/saml2/idpresponse' },
    ...overrides,
  };
}

/** A DRAFT OIDC connection (issuer and client id set; the secret is write-only and never present). */
export function oidcConnection(id: string, overrides: Partial<SsoConnectionResponse> = {}): SsoConnectionResponse {
  return ssoConnection(id, {
    protocol: 'OIDC',
    cognitoProviderName: `org-${id}-oidc`,
    metadataUrl: null,
    oidcIssuer: 'https://login.example.test',
    oidcClientId: 'client-1',
    ...overrides,
  });
}

/** The operations API with the SSO routes mocked; every route answers a plausible success. */
export function ssoApi(overrides: Record<string, unknown> = {}) {
  return makeOpsApi({
    listSsoConnections: vi.fn().mockResolvedValue({ items: [] }),
    createSsoConnection: vi.fn().mockResolvedValue(ssoConnection('new')),
    updateSsoConnection: vi.fn().mockResolvedValue(ssoConnection('updated')),
    addSsoDomain: vi.fn().mockResolvedValue(ssoDomain('d_new', 'new.example.test', false)),
    verifySsoDomain: vi.fn().mockResolvedValue(ssoDomain('d_pending', 'pending.example.test', true)),
    testSsoConnection: vi.fn().mockResolvedValue({ startUrl: START_URL }),
    activateSsoConnection: vi.fn().mockResolvedValue(ssoConnection('activated', { status: 'ACTIVE' })),
    ...overrides,
  });
}
