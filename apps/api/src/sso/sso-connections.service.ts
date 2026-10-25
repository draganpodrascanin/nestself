/**
 * SsoConnectionsService: the staff lifecycle of an employer's SSO connection
 * (3.4.1) and DNS domain verification (3.4.4).
 *
 *   create  -> DRAFT
 *   POST :id/test      DRAFT|TESTING -> TESTING  (>= 1 verified domain; registers the provider)
 *   POST :id/activate  TESTING -> ACTIVE         (lastTestedAt set by a bound test sign-in)
 *   PATCH status       ACTIVE -> SUSPENDED, SUSPENDED -> ACTIVE, TESTING -> DRAFT (removes the provider)
 *   PATCH provider fields on ACTIVE -> TESTING (lastTestedAt cleared: re-test, then activate)
 *
 * The provider is registered in the identity provider (Cognito) when the
 * connection is tested. One exception: an OIDC client secret is write-only
 * and NestSelf never stores it (3.4.2), so a secret sent while the
 * connection is still DRAFT registers the provider straight away and the
 * identity provider keeps it ("staged" registration). Discovery ignores
 * DRAFT connections either way.
 *
 * Writes run in the connection's tenant scope (`withOrgScope`, so row-level
 * security checks them) and share that transaction with their audit
 * events; status changes are conditional on the status read (a concurrent
 * change answers 409). Any reset, re-test or provider change while TESTING
 * or ACTIVE clears `lastTestedAt` (an ACTIVE connection moves back to
 * TESTING), so activation always follows a test sign-in against the current
 * configuration (SSO-R-01).
 *
 * A slug belongs to one organization: create and a DRAFT protocol change
 * refuse with 409 `conflict` (`details.reason: 'provider_name_taken'`) when
 * a connection of another organization holds `org-<slug>-saml` or
 * `org-<slug>-oidc`. Cognito keeps federated pool users after their provider
 * is deleted, so a reused name would hand that organization the other's
 * users and their `sub`.
 *
 * Every status change audits `sso_connection.changed { from, to }`
 * (SSO-R-02). Audit details never carry the client secret or the domain
 * verification token.
 */
import { Inject, Injectable } from '@nestjs/common';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { SSO_TEST_TTL, ssoTestKey } from '../redis/redis-keys.js';
import { buildSsoStartUrl } from '../auth/sso-start-url.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  Principal,
  SsoConnectionCreateRequest,
  SsoConnectionListResponse,
  SsoConnectionResponse,
  SsoConnectionStatus,
  SsoConnectionUpdateRequest,
  SsoDomainResponse,
  SsoProtocol,
  SsoSpMetadata,
  SsoTestResponse,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import type { AuditAction } from '../audit/audit-events.js';
import { isPublicEmailDomain } from '../auth/constants.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityResolutionService } from '../auth/identity-resolution.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrgUnitsRepository } from '../db/repositories/org-units.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SsoRepository } from '../db/repositories/sso.repository.js';
import {
  isUniqueViolation,
  type SsoConnectionPatch,
  type SsoConnectionRow,
  type SsoConnectionWithDomains,
  type SsoDomainRow,
} from '../db/repositories/sso.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityProviderService } from '../identity/identity-provider.service.js';
import {
  IdentityProviderError,
  type ProviderInput,
} from '../identity/identity-provider.service.js';
import { DNS_TXT_RESOLVER, type DnsTxtResolver } from './dns-txt-resolver.js';
import { ProviderNameTooLongError, buildProviderName, slugProviderNames } from './provider-name.js';

/** DI token of {@link SsoConfig}. */
export const SSO_CONFIG = Symbol('SSO_CONFIG');

export interface SsoConfig {
  /** Absolute origin of the API (`API_PUBLIC_URL`), no trailing slash. */
  apiPublicUrl: string;
  /** Values for the client's IdP administrator; null when the stage has no Cognito domain. */
  spMetadata: SsoSpMetadata | null;
}

export const TXT_RECORD_PREFIX = '_nestself-verify.';
export const TXT_VALUE_PREFIX = 'nestself-domain-verification=';

export const txtRecordName = (domain: string): string => `${TXT_RECORD_PREFIX}${domain}`;
export const txtRecordValue = (token: string): string => `${TXT_VALUE_PREFIX}${token}`;

/** Statuses in which the provider is registered in the identity provider. */
const REGISTERED_STATUSES: ReadonlySet<SsoConnectionStatus> = new Set(['TESTING', 'ACTIVE', 'SUSPENDED']);

/** Fields whose change must reach the registered provider. */
const PROVIDER_FIELDS = [
  'metadataUrl',
  'metadataXml',
  'oidcIssuer',
  'oidcClientId',
  'oidcClientSecret',
  'attributeMapping',
] as const;

function validation(message: string, details?: Record<string, unknown>): ApiHttpException {
  return new ApiHttpException({ status: 422, code: 'validation', message, details });
}

function connectionState(message: string): ApiHttpException {
  return new ApiHttpException({ status: 409, code: 'sso_connection_state', message });
}

function conflict(message: string): ApiHttpException {
  return new ApiHttpException({ status: 409, code: 'conflict', message });
}

/** 409 for a provider name whose slug another organization holds. */
function providerNameTaken(field: 'slug' | 'protocol'): ApiHttpException {
  return new ApiHttpException({
    status: 409,
    code: 'conflict',
    message: 'Another organization uses this slug for its SSO connection',
    details: { reason: 'provider_name_taken', field },
  });
}

function notFound(message: string): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message });
}

function secretNotApplicable(): ApiHttpException {
  return validation('oidcClientSecret applies to OIDC connections only', { field: 'oidcClientSecret' });
}

/** 422 for a well-formed slug whose provider name would exceed 20 characters. */
export function slugTooLong(): ApiHttpException {
  return validation('The provider name built from the slug exceeds 20 characters; choose a shorter slug', {
    field: 'slug',
  });
}

/** 422 for `idpInitiatedAllowed: true` (SSO-R-12, D-12). */
export function idpInitiatedRefused(): ApiHttpException {
  return validation('IdP-initiated sign-in is not available', { field: 'idpInitiatedAllowed' });
}

/** Timing-safe string equality (SSO-R-06). */
function sameValue(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Injectable()
export class SsoConnectionsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: SsoRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly orgUnits: OrgUnitsRepository,
    private readonly idp: IdentityProviderService,
    private readonly identity: IdentityResolutionService,
    private readonly audit: AuditWriter,
    @Inject(DNS_TXT_RESOLVER) private readonly dns: DnsTxtResolver,
    @Inject(SSO_CONFIG) private readonly config: SsoConfig,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────

  async list(filter: { orgId?: string }): Promise<SsoConnectionListResponse> {
    const rows = await this.repo.listConnections(filter);
    return { items: rows.map((row) => this.toResponse(row)) };
  }

  // ── Create ────────────────────────────────────────────────────────────

  async create(body: SsoConnectionCreateRequest, actor: Principal): Promise<SsoConnectionResponse> {
    if (body.idpInitiatedAllowed) throw idpInitiatedRefused();
    const name = this.providerName(body.slug, body.protocol);
    if (body.oidcClientSecret !== undefined && body.protocol !== 'OIDC') throw secretNotApplicable();

    if (!(await this.organizations.findById(body.orgId))) throw notFound('Organization not found');
    if (body.defaultOrgUnitId) await this.assertOrgUnit(body.orgId, body.defaultOrgUnitId);
    await this.assertProviderNameAvailable(name, body.orgId, 'slug');

    const values = {
      orgId: body.orgId,
      protocol: body.protocol,
      cognitoProviderName: name,
      status: 'DRAFT' as const,
      metadataUrl: body.metadataUrl ?? null,
      metadataXml: body.metadataXml ?? null,
      oidcIssuer: body.oidcIssuer ?? null,
      oidcClientId: body.oidcClientId ?? null,
      attributeMapping: body.attributeMapping ?? null,
      idpInitiatedAllowed: false,
      jitProvisioning: body.jitProvisioning,
      defaultOrgUnitId: body.defaultOrgUnitId ?? null,
    };

    // Staged OIDC registration: the identity provider is the only place the
    // write-only client secret is kept.
    const stage = body.protocol === 'OIDC' && body.oidcClientSecret !== undefined;
    if (stage) {
      await this.callIdp(() =>
        this.idp.createProvider(this.providerInput({ ...values }, body.oidcClientSecret)),
      );
    }

    let row: SsoConnectionRow;
    try {
      row = await this.db.withOrgScope(body.orgId, async (tx) => {
        const created = await this.repo.createConnection(values, tx);
        await this.audit.record(
          this.event('sso_connection.created', created, actor, {
            protocol: created.protocol,
            cognitoProviderName: created.cognitoProviderName,
            jitProvisioning: created.jitProvisioning,
            providerStaged: stage,
          }),
        );
        return created;
      });
    } catch (err) {
      if (stage) await this.idp.deleteProvider(name).catch(() => undefined);
      if (isUniqueViolation(err)) throw conflict('A connection with this provider name already exists');
      throw err;
    }
    return this.toResponse({ ...row, domains: [] });
  }

  // ── Update ────────────────────────────────────────────────────────────

  async update(id: string, body: SsoConnectionUpdateRequest, actor: Principal): Promise<SsoConnectionResponse> {
    if (body.idpInitiatedAllowed === true) throw idpInitiatedRefused();
    const conn = await this.load(id);
    const from = conn.status;
    let to = body.status && body.status !== from ? body.status : from;

    if (to !== from) this.assertPatchTransition(conn, to);

    const protocolChange = body.protocol !== undefined && body.protocol !== conn.protocol;
    if (protocolChange && from !== 'DRAFT') {
      throw validation('The protocol cannot change after the connection was tested; reset it to DRAFT first', {
        field: 'protocol',
      });
    }
    if (body.defaultOrgUnitId) await this.assertOrgUnit(conn.orgId, body.defaultOrgUnitId);
    if (body.oidcClientSecret !== undefined && (body.protocol ?? conn.protocol) !== 'OIDC') {
      throw secretNotApplicable();
    }
    if (body.oidcClientSecret !== undefined && to === 'DRAFT') {
      throw validation('A reset to DRAFT removes the provider; send the client secret in a separate request', {
        field: 'oidcClientSecret',
      });
    }

    const patch: SsoConnectionPatch = {};
    const changedFields: string[] = [];
    const setField = <K extends keyof SsoConnectionPatch>(key: K, value: SsoConnectionPatch[K] | undefined) => {
      if (value === undefined) return;
      patch[key] = value;
      changedFields.push(key);
    };
    setField('metadataUrl', body.metadataUrl);
    setField('metadataXml', body.metadataXml);
    setField('oidcIssuer', body.oidcIssuer);
    setField('oidcClientId', body.oidcClientId);
    setField('attributeMapping', body.attributeMapping);
    setField('jitProvisioning', body.jitProvisioning);
    setField('defaultOrgUnitId', body.defaultOrgUnitId);
    if (body.idpInitiatedAllowed === false) setField('idpInitiatedAllowed', false);
    if (body.oidcClientSecret !== undefined) changedFields.push('oidcClientSecret');

    let name = conn.cognitoProviderName;
    if (protocolChange) {
      setField('protocol', body.protocol);
      name = conn.cognitoProviderName.replace(/-(saml|oidc)$/, `-${body.protocol!.toLowerCase()}`);
      await this.assertProviderNameAvailable(name, conn.orgId, 'protocol', conn.id);
    }

    const merged = { ...conn, ...patch, cognitoProviderName: name };
    const providerChanged = PROVIDER_FIELDS.some((f) => changedFields.includes(f));

    // SSO-R-01: a provider change on an ACTIVE connection takes it back to
    // TESTING, so it is activated again only after a test sign-in against
    // the new configuration. Combined with a suspension it is ambiguous.
    if (from === 'ACTIVE' && providerChanged) {
      if (to !== from) {
        throw validation('Change the provider settings and the status in separate requests', { field: 'status' });
      }
      to = 'TESTING';
    }

    // Identity provider first: a refused configuration leaves the row unchanged.
    if (to === 'DRAFT') {
      await this.callIdp(() => this.idp.deleteProvider(conn.cognitoProviderName));
    } else if (REGISTERED_STATUSES.has(from)) {
      if (providerChanged) {
        await this.callIdp(() => this.idp.updateProvider(this.providerInput(merged, body.oidcClientSecret)));
      }
    } else {
      await this.syncStagedProvider(conn, merged, protocolChange, providerChanged, body.oidcClientSecret);
    }

    if (to !== from) patch.status = to;
    if (protocolChange) patch.cognitoProviderName = name;
    // A reset or a provider change while TESTING or ACTIVE invalidates the last test sign-in.
    if (to === 'DRAFT' || ((from === 'TESTING' || from === 'ACTIVE') && providerChanged)) patch.lastTestedAt = null;

    let updated: SsoConnectionRow;
    try {
      updated = await this.db.withOrgScope(conn.orgId, async (tx) => {
        const row = await this.repo.updateConnection(id, patch, tx, { fromStatus: from });
        if (!row) throw connectionState('The connection changed meanwhile; reload and try again');
        if (changedFields.length > 0) {
          await this.audit.record(this.event('sso_connection.updated', row, actor, { fields: changedFields }));
        }
        if (to !== from) await this.recordStatusChange(row, actor, from, to);
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A connection with this provider name already exists');
      throw err;
    }
    return this.toResponse({ ...updated, domains: conn.domains });
  }

  /**
   * DRAFT connection: keep a staged OIDC registration in line with the row.
   * A secret registers it, later provider changes update it, and a switch
   * to SAML drops it.
   */
  private async syncStagedProvider(
    conn: SsoConnectionRow,
    merged: SsoConnectionRow,
    protocolChange: boolean,
    providerChanged: boolean,
    secret: string | undefined,
  ): Promise<void> {
    if (protocolChange) {
      if (conn.protocol === 'OIDC') {
        await this.callIdp(() => this.idp.deleteProvider(conn.cognitoProviderName));
      } else if (secret !== undefined) {
        await this.callIdp(() => this.idp.createProvider(this.providerInput(merged, secret)));
      }
      return;
    }
    if (conn.protocol !== 'OIDC' || !providerChanged) return;
    const staged = await this.callIdp(() => this.idp.describeProvider(conn.cognitoProviderName));
    if (!staged && secret === undefined) return;
    const input = this.providerInput(merged, secret);
    if (staged) await this.callIdp(() => this.idp.updateProvider(input));
    else await this.callIdp(() => this.idp.createProvider(input));
  }

  // ── Domains ───────────────────────────────────────────────────────────

  async addDomain(id: string, domain: string, actor: Principal): Promise<SsoDomainResponse> {
    const conn = await this.load(id);
    if (isPublicEmailDomain(domain)) {
      throw new ApiHttpException({
        status: 422,
        code: 'domain_blocklisted',
        message: 'Public email domains cannot be used for SSO',
      });
    }
    if (await this.repo.findDomainByName(domain)) throw conflict('This domain is already attached to a connection');

    let row: SsoDomainRow;
    try {
      row = await this.db.withOrgScope(conn.orgId, async (tx) => {
        const added = await this.repo.addDomain(
          { connectionId: conn.id, domain, verificationToken: randomBytes(16).toString('hex') },
          tx,
        );
        await this.audit.record(
          this.event('sso_domain.added', conn, actor, { connectionId: conn.id, domain: added.domain }, {
            recordType: 'sso_domain',
            recordId: added.id,
          }),
        );
        return added;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('This domain is already attached to a connection');
      throw err;
    }
    return toDomainResponse(row);
  }

  async verifyDomain(id: string, domainId: string, actor: Principal): Promise<SsoDomainResponse> {
    const conn = await this.load(id);
    const row = await this.repo.findDomain(conn.id, domainId);
    if (!row) throw notFound('Domain not found');
    if (row.verifiedAt) return toDomainResponse(row);
    if (isPublicEmailDomain(row.domain)) {
      throw new ApiHttpException({
        status: 422,
        code: 'domain_blocklisted',
        message: 'Public email domains cannot be used for SSO',
      });
    }

    const expected = txtRecordValue(row.verificationToken);
    const values = await this.dns.lookupTxt(txtRecordName(row.domain));
    // Compare every value so the time taken does not depend on which matched.
    let matched = false;
    for (const value of values) {
      if (sameValue(value.trim(), expected)) matched = true;
    }
    if (!matched) {
      throw new ApiHttpException({
        status: 422,
        code: 'domain_unverified',
        message: 'The DNS TXT record was not found or does not match',
      });
    }

    const verified = await this.db.withOrgScope(conn.orgId, async (tx) => {
      const marked = (await this.repo.markDomainVerified(row.id, new Date(), tx)) ?? row;
      await this.audit.record(
        this.event('sso_domain.verified', conn, actor, { connectionId: conn.id, domain: row.domain }, {
          recordType: 'sso_domain',
          recordId: row.id,
        }),
      );
      return marked;
    });
    return toDomainResponse(verified);
  }

  // ── Test and activate ─────────────────────────────────────────────────

  async test(id: string, actor: Principal): Promise<SsoTestResponse> {
    const conn = await this.load(id);
    if (conn.status !== 'DRAFT' && conn.status !== 'TESTING') {
      throw connectionState('Only a DRAFT or TESTING connection can be tested');
    }
    if (!conn.domains.some((d) => d.verifiedAt)) {
      throw connectionState('Verify at least one domain before testing the connection');
    }

    const input = this.providerInput(conn);
    const existing = await this.callIdp(() => this.idp.describeProvider(conn.cognitoProviderName));
    if (existing) {
      await this.callIdp(() => this.idp.updateProvider(input));
    } else {
      if (input.protocol === 'OIDC' && !input.oidcClientSecret) {
        throw validation('Send the OIDC client secret before testing the connection', { field: 'oidcClientSecret' });
      }
      await this.callIdp(() => this.idp.createProvider(input));
    }
    const info = await this.idp.describeProvider(conn.cognitoProviderName).catch(() => null);

    // Every test needs a new test sign-in before activation (SSO-R-01).
    await this.db.withOrgScope(conn.orgId, async (tx) => {
      const updated = await this.repo.updateConnection(
        conn.id,
        {
          status: 'TESTING',
          lastTestedAt: null,
          ...(info ? { certificateExpiresAt: info.certificateExpiresAt } : {}),
        },
        tx,
        { fromStatus: conn.status },
      );
      if (!updated) throw connectionState('The connection changed meanwhile; reload and try again');
      if (conn.status !== 'TESTING') await this.recordStatusChange(updated, actor, conn.status, 'TESTING');
      await this.audit.record(
        this.event('sso_connection.tested', updated, actor, { cognitoProviderName: conn.cognitoProviderName }),
      );
    });

    // A single-use nonce: only this staff test flow may start (and bind) on
    // the TESTING connection; the callback spends it.
    const testNonce = randomBytes(32).toString('base64url');
    await this.store.set(ssoTestKey(testNonce), JSON.stringify({ connectionId: conn.id }), { ttlSeconds: SSO_TEST_TTL });
    return {
      startUrl: buildSsoStartUrl(this.config.apiPublicUrl, {
        connection: conn.cognitoProviderName,
        surface: 'workspace',
        testNonce,
      }),
    };
  }

  async activate(id: string, actor: Principal): Promise<SsoConnectionResponse> {
    const conn = await this.load(id);
    if (conn.status !== 'TESTING') throw connectionState('Only a TESTING connection can be activated');
    this.assertActivatable(conn);
    const updated = await this.db.withOrgScope(conn.orgId, async (tx) => {
      const row = await this.repo.updateConnection(conn.id, { status: 'ACTIVE' }, tx, { fromStatus: 'TESTING' });
      if (!row) throw connectionState('The connection changed meanwhile; reload and try again');
      await this.recordStatusChange(row, actor, 'TESTING', 'ACTIVE');
      return row;
    });
    return this.toResponse({ ...updated, domains: conn.domains });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async load(id: string): Promise<SsoConnectionWithDomains> {
    const conn = await this.repo.findConnection(id);
    if (!conn) throw notFound('SSO connection not found');
    return conn;
  }

  private providerName(slug: string, protocol: SsoProtocol): string {
    try {
      return buildProviderName(slug, protocol);
    } catch (err) {
      if (err instanceof ProviderNameTooLongError) {
        throw validation('The provider name built from the slug exceeds 20 characters; choose a shorter slug', {
          field: 'slug',
          providerName: err.providerName,
        });
      }
      throw err;
    }
  }

  /**
   * The slug reservation: 409 `provider_name_taken` when a connection of
   * another organization holds either protocol's name of this slug, 409
   * `conflict` when another connection of the same organization holds the
   * exact name. Unscoped (system context) read: RLS would hide the other
   * tenants' rows.
   */
  private async assertProviderNameAvailable(
    name: string,
    orgId: string,
    field: 'slug' | 'protocol',
    selfId?: string,
  ): Promise<void> {
    const holders = await this.repo.findConnectionsByProviderNames(slugProviderNames(name));
    if (holders.some((c) => c.orgId !== orgId)) throw providerNameTaken(field);
    if (holders.some((c) => c.cognitoProviderName === name && c.id !== selfId)) {
      throw conflict('A connection with this provider name already exists');
    }
  }

  private async assertOrgUnit(orgId: string, unitId: string): Promise<void> {
    if (!(await this.orgUnits.findByIdAndOrg(unitId, orgId))) {
      throw validation('The default org unit does not belong to the organization', { field: 'defaultOrgUnitId' });
    }
  }

  /** SSO-R-01: a test sign-in has bound and at least one domain is verified. */
  private assertActivatable(conn: SsoConnectionWithDomains): void {
    if (!conn.lastTestedAt) throw connectionState('Complete a test sign-in before activating the connection');
    if (!conn.domains.some((d) => d.verifiedAt)) throw connectionState('The connection has no verified domain');
  }

  /** PATCH transitions: ACTIVE -> SUSPENDED, SUSPENDED -> ACTIVE, TESTING -> DRAFT. */
  private assertPatchTransition(conn: SsoConnectionWithDomains, to: SsoConnectionStatus): void {
    const from = conn.status;
    if (to === 'SUSPENDED' && from === 'ACTIVE') return;
    if (to === 'ACTIVE' && from === 'SUSPENDED') return this.assertActivatable(conn);
    if (to === 'DRAFT' && from === 'TESTING') return;
    if (to === 'ACTIVE' && from === 'TESTING') {
      throw connectionState('Use POST /ops/sso-connections/:id/activate to activate a tested connection');
    }
    throw connectionState(`A ${from} connection cannot move to ${to}`);
  }

  /** The registration input; 422 when the protocol's required fields are missing. */
  private providerInput(conn: Pick<SsoConnectionRow, 'cognitoProviderName' | 'protocol' | 'metadataUrl' | 'metadataXml' | 'oidcIssuer' | 'oidcClientId' | 'attributeMapping'>, secret?: string): ProviderInput {
    if (conn.protocol === 'SAML') {
      if (!conn.metadataUrl && !conn.metadataXml) {
        throw validation('A SAML connection needs metadataUrl or metadataXml', { fields: ['metadataUrl', 'metadataXml'] });
      }
    } else if (!conn.oidcIssuer || !conn.oidcClientId) {
      throw validation('An OIDC connection needs oidcIssuer and oidcClientId', { fields: ['oidcIssuer', 'oidcClientId'] });
    }
    return {
      name: conn.cognitoProviderName,
      protocol: conn.protocol,
      ...(conn.metadataUrl ? { metadataUrl: conn.metadataUrl } : {}),
      ...(conn.metadataXml ? { metadataXml: conn.metadataXml } : {}),
      ...(conn.oidcIssuer ? { oidcIssuer: conn.oidcIssuer } : {}),
      ...(conn.oidcClientId ? { oidcClientId: conn.oidcClientId } : {}),
      ...(secret ? { oidcClientSecret: secret } : {}),
      attributeMapping: conn.attributeMapping ?? {},
    };
  }

  /**
   * Identity provider errors as API errors. A configuration the provider
   * refuses (`not_authorized`, Cognito's InvalidParameterException) is the
   * caller's to fix: 422.
   */
  private async callIdp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof IdentityProviderError)) throw err;
      if (err.code === 'not_authorized') {
        throw validation('The identity provider refused the connection configuration');
      }
      throw this.identity.mapIdpError(err);
    }
  }

  private async recordStatusChange(
    row: SsoConnectionRow,
    actor: Principal,
    from: SsoConnectionStatus,
    to: SsoConnectionStatus,
  ): Promise<void> {
    await this.audit.record(this.event('sso_connection.changed', row, actor, { from, to }));
    if (to === 'ACTIVE') await this.audit.record(this.event('sso_connection.activated', row, actor, { from }));
    if (to === 'SUSPENDED') await this.audit.record(this.event('sso_connection.deactivated', row, actor, { from }));
  }

  private event(
    action: AuditAction,
    conn: SsoConnectionRow,
    actor: Principal,
    details: Record<string, unknown>,
    record: { recordType: string; recordId: string } = { recordType: 'sso_connection', recordId: conn.id },
  ): AuditEventInput {
    return {
      action,
      actorUserId: actor.userId,
      actorKind: 'USER',
      orgId: conn.orgId,
      recordType: record.recordType,
      recordId: record.recordId,
      result: 'ALLOWED',
      sessionId: actor.sessionId,
      details,
    };
  }

  private toResponse(row: SsoConnectionWithDomains): SsoConnectionResponse {
    return {
      id: row.id,
      orgId: row.orgId,
      protocol: row.protocol,
      cognitoProviderName: row.cognitoProviderName,
      status: row.status,
      metadataUrl: row.metadataUrl,
      oidcIssuer: row.oidcIssuer,
      oidcClientId: row.oidcClientId,
      idpInitiatedAllowed: row.idpInitiatedAllowed,
      jitProvisioning: row.jitProvisioning,
      defaultOrgUnitId: row.defaultOrgUnitId,
      certificateExpiresAt: row.certificateExpiresAt?.toISOString() ?? null,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      domains: row.domains.map(toDomainResponse),
      spMetadata: this.config.spMetadata,
    };
  }
}

function toDomainResponse(row: SsoDomainRow): SsoDomainResponse {
  return {
    id: row.id,
    domain: row.domain,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    txtRecordName: txtRecordName(row.domain),
    txtRecordValue: txtRecordValue(row.verificationToken),
  };
}

/** SP metadata from the pool id and Cognito domain; null when either is unknown. */
export function spMetadataFor(poolId: string | undefined, cognitoDomain: string | undefined): SsoSpMetadata | null {
  if (!poolId || !cognitoDomain) return null;
  return {
    entityId: `urn:amazon:cognito:sp:${poolId}`,
    acsUrl: `${cognitoDomain.replace(/\/+$/, '')}/saml2/idpresponse`,
  };
}
