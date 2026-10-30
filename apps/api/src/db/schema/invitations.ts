/**
 * Invitation and enterprise SSO tables [D-03, D-12].
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ssoConnectionStatus, ssoProtocol } from './enums.js';
import { users } from './identity.js';
import { organizations, orgUnits } from './organization.js';
import {
  CURRENT_ORG_SETTING,
  createdAt,
  idColumn,
  tenantPredicate,
  tenantPredicateVia,
  ts,
} from './_shared.js';

/**
 * A revocable, expiring token that lets an invited person activate a
 * membership [D-03, ORG-02]. Tenant-scoped (RLS).
 */
export const invitations = pgTable(
  'invitations',
  {
    id: idColumn(),
    /** Normalised lowercase email of the invitee. */
    email: text().notNull(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Target org unit for the new membership. */
    orgUnitId: text().references(() => orgUnits.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    /** Permission template key for the initial grant. */
    templateKey: text(),
    /** SHA-256 of the invitation token [D-03]. */
    tokenHash: text().notNull(),
    /** Default 7 days from creation [D-03]. */
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    acceptedAt: ts(),
    acceptedUserId: text().references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    invitedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Correlation id for bulk HR imports. */
    importBatchId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    index('invitations_email_org_id_idx').on(t.email, t.orgId),
    /** Pending invitations. */
    index('idx_invitations_pending')
      .on(t.email, t.orgId)
      .where(sql`${t.revokedAt} IS NULL AND ${t.acceptedAt} IS NULL`),
    pgPolicy('invitations_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** An organization's identity-provider configuration [D-12]. Tenant-scoped (RLS). */
export const ssoConnections = pgTable(
  'sso_connections',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    protocol: ssoProtocol().notNull(),
    /** Cognito pool-level provider name [D-12]. */
    cognitoProviderName: text().notNull(),
    status: ssoConnectionStatus().notNull().default('DRAFT'),
    metadataUrl: text(),
    metadataXml: text(),
    oidcIssuer: text(),
    oidcClientId: text(),
    /** IdP attribute to NestSelf field mapping [D-12]. */
    attributeMapping: jsonb().$type<Record<string, string>>(),
    /** Requires written risk acceptance [D-12, DR-06]. */
    idpInitiatedAllowed: boolean().notNull().default(false),
    /** Auto-create ACTIVE memberships for verified-domain sign-ins [D-03]. */
    jitProvisioning: boolean().notNull().default(false),
    /**
     * OIDC only (SSO-R-08): an ID token without `email_verified: true` binds
     * only after the user confirms the address with a mailed code. Staff may
     * turn it off for a provider that never sends the claim.
     */
    oidcEmailVerifiedClaimRequired: boolean().notNull().default(true),
    defaultOrgUnitId: text().references(() => orgUnits.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** IdP signing certificate expiry; reminders at 30 days [D-12]. */
    certificateExpiresAt: ts(),
    lastTestedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sso_connections_cognito_provider_name_key').on(t.cognitoProviderName),
    index('sso_connections_org_id_idx').on(t.orgId),
    pgPolicy('sso_connections_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** A row is visible when its connection belongs to the current tenant. */
const SSO_DOMAINS_TENANT_EXISTS = `select 1 from "sso_connections" where "sso_connections"."id" = "sso_domains"."connection_id" and "sso_connections"."org_id" = ${CURRENT_ORG_SETTING}`;

/**
 * A verified email domain bound to an SSO connection [D-12]. Tenant-scoped
 * (RLS) through `sso_connections.org_id`; home-realm discovery reads it in
 * the system context (no tenant setting).
 */
export const ssoDomains = pgTable(
  'sso_domains',
  {
    id: idColumn(),
    connectionId: text()
      .notNull()
      .references(() => ssoConnections.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Lowercase; public email domains rejected by the API [D-12, DR-07]. */
    domain: text().notNull(),
    /** DNS TXT record value for domain ownership proof. */
    verificationToken: text().notNull(),
    /** Non-null means the DNS TXT check passed. */
    verifiedAt: ts(),
  },
  (t) => [
    uniqueIndex('sso_domains_domain_key').on(t.domain),
    /** Domains of a connection, and "has at least one verified domain" (POST :id/test). */
    index('sso_domains_connection_id_verified_at_idx').on(t.connectionId, t.verifiedAt),
    pgPolicy('sso_domains_tenant_isolation', {
      for: 'all',
      using: tenantPredicateVia(SSO_DOMAINS_TENANT_EXISTS),
      withCheck: tenantPredicateVia(SSO_DOMAINS_TENANT_EXISTS),
    }),
  ],
).enableRLS();
