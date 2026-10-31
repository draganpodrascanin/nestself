/**
 * Enterprise-SSO state of the fake identity provider: registered providers,
 * seeded federated users (the employer IdP's accounts) and single-use
 * authorization codes bound to a PKCE S256 challenge.
 *
 * Extracted to keep fake-identity-provider.ts small.
 *
 * @see D-12, 3.4 Enterprise SSO
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { IdentityProviderError } from './identity-provider.service.js';
import type {
  ProviderInfo,
  ProviderInput,
  ProviderProtocol,
} from './identity-provider.service.js';
import { certificateExpiryFromMetadata } from './saml-metadata.js';

export const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;

export interface FakeProvider {
  name: string;
  protocol: ProviderProtocol;
  metadataUrl: string | null;
  metadataXml: string | null;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  attributeMapping: Record<string, string>;
  certificateExpiresAt: Date | null;
}

export interface FakeFederatedUser {
  providerName: string;
  /** The subject (NameID / `sub`) at the employer's IdP. */
  subject: string;
  email: string;
  /** null: the IdP sends no `email_verified` claim at all (Entra ID by default). */
  emailVerified: boolean | null;
  /** Pool username; defaults to Cognito's `<providerName>_<subject>`. */
  username: string;
}

interface FakeAuthorizationCode {
  providerName: string;
  subject: string;
  codeChallenge: string;
  redirectUri: string | null;
  expiresAt: number;
}

/** PKCE S256: base64url(SHA-256(verifier)). */
export function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class FakeSsoStore {
  readonly providers = new Map<string, FakeProvider>();
  private readonly federatedUsers = new Map<string, FakeFederatedUser>();
  private readonly codes = new Map<string, FakeAuthorizationCode>();

  // -- Providers ------------------------------------------------------------

  private toProvider(input: ProviderInput, certificateExpiresAt: Date | null): FakeProvider {
    // The OIDC client secret is write-only, as in Cognito's API surface we use.
    return {
      name: input.name,
      protocol: input.protocol,
      metadataUrl: input.metadataUrl ?? null,
      metadataXml: input.metadataXml ?? null,
      oidcIssuer: input.oidcIssuer ?? null,
      oidcClientId: input.oidcClientId ?? null,
      attributeMapping: { ...input.attributeMapping },
      certificateExpiresAt,
    };
  }

  createProvider(input: ProviderInput): void {
    if (this.providers.has(input.name)) {
      throw new IdentityProviderError('Provider already exists', 'provider_exists');
    }
    const expiry = input.protocol === 'SAML' ? certificateExpiryFromMetadata(input.metadataXml) : null;
    this.providers.set(input.name, this.toProvider(input, expiry));
  }

  updateProvider(input: ProviderInput): void {
    const existing = this.providers.get(input.name);
    if (!existing) {
      throw new IdentityProviderError('Provider not found', 'provider_not_found');
    }
    const parsed = input.protocol === 'SAML' ? certificateExpiryFromMetadata(input.metadataXml) : null;
    this.providers.set(input.name, this.toProvider(input, parsed ?? existing.certificateExpiresAt));
  }

  deleteProvider(name: string): void {
    this.providers.delete(name);
  }

  describeProvider(name: string): ProviderInfo | null {
    const p = this.providers.get(name);
    if (!p) return null;
    return { name: p.name, protocol: p.protocol, certificateExpiresAt: p.certificateExpiresAt };
  }

  /** Tests: pretend the provider's metadata carries a certificate expiring at `at`. */
  setCertificateExpiry(name: string, at: Date | null): void {
    const p = this.providers.get(name);
    if (!p) throw new IdentityProviderError('Provider not found', 'provider_not_found');
    p.certificateExpiresAt = at;
  }

  // -- Federated users ------------------------------------------------------

  seedFederatedUsers(
    users: Array<{
      providerName: string;
      subject: string;
      email: string;
      /** null: no `email_verified` claim at all. */
      emailVerified: boolean | null;
      username?: string;
    }>,
  ): void {
    for (const u of users) {
      this.federatedUsers.set(`${u.providerName}\u0000${u.subject}`, {
        providerName: u.providerName,
        subject: u.subject,
        email: u.email.toLowerCase(),
        emailVerified: u.emailVerified,
        username: u.username ?? `${u.providerName}_${u.subject}`,
      });
    }
  }

  findFederatedUser(providerName: string, subject: string): FakeFederatedUser | undefined {
    return this.federatedUsers.get(`${providerName}\u0000${subject}`);
  }

  listFederatedUsers(providerName: string): FakeFederatedUser[] {
    return [...this.federatedUsers.values()].filter((u) => u.providerName === providerName);
  }

  // -- Authorization codes --------------------------------------------------

  issueAuthorizationCode(
    providerName: string,
    subject: string,
    codeChallenge: string,
    redirectUri?: string,
  ): string {
    if (!this.providers.has(providerName)) {
      throw new IdentityProviderError('Provider not found', 'provider_not_found');
    }
    if (!this.findFederatedUser(providerName, subject)) {
      throw new IdentityProviderError('Federated user not found', 'user_not_found');
    }
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, {
      providerName,
      subject,
      codeChallenge,
      redirectUri: redirectUri ?? null,
      expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS,
    });
    return code;
  }

  /**
   * Single use: the code is gone after the first attempt, matching or not.
   * `invalid_code` for an unknown, used or expired code, a wrong verifier or
   * a different redirect URI.
   */
  redeemAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): FakeFederatedUser {
    const entry = this.codes.get(input.code);
    this.codes.delete(input.code);
    const invalid = () => new IdentityProviderError('Invalid authorization code', 'invalid_code');
    if (!entry || entry.expiresAt < Date.now()) throw invalid();
    // Cognito no longer federates through a provider that was deleted meanwhile.
    if (!this.providers.has(entry.providerName)) throw invalid();
    if (!sameString(s256(input.codeVerifier), entry.codeChallenge)) throw invalid();
    if (entry.redirectUri !== null && entry.redirectUri !== input.redirectUri) throw invalid();
    const user = this.findFederatedUser(entry.providerName, entry.subject);
    if (!user) throw invalid();
    return user;
  }
}
