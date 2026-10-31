/**
 * Maps a failed SSO connection call to a translation key under
 * `admin:sso.errors.*` and, for the calls made from a form, the field the
 * failure belongs to. The API's own `message` is English and meant for
 * developers, so it is never rendered; an unknown code still gets `unknown`.
 *
 * Codes the SSO routes return (`apps/api/src/sso/sso-connections.service.ts`
 * and the controller's body pipe): `domain_blocklisted`, `domain_unverified`,
 * `sso_connection_state`, `conflict` (provider name on create, domain on
 * add; `details.reason: 'provider_name_taken'` when another organization
 * holds the slug, on create or a protocol change), `validation` (422 with `details.field` or `details.fields`, or none
 * when the identity provider refused the configuration; 400 from the body
 * schema; 422 with `details.field` `metadataUrl` or `oidcIssuer` and
 * `details.reason` `scheme`, `host` or `private_address` when the address is
 * not a public https URL, on create, update and test), `not_found` (the
 * organization on create, otherwise the connection or domain), `forbidden`,
 * `rate_limited`, `unavailable` (identity provider down, or, with an address
 * to check, the name resolver). `step_up_required` is answered by
 * `withStepUp`; it reaches this mapper only when the retry is refused again
 * and then shows `unknown`.
 *
 * `null` means the user cancelled the step-up of an action: not a failure,
 * nothing to show. A cancelled step-up of the list read (`load`) is
 * `stepUpCancelled`, because the page then has no list to show and offers
 * Try again.
 */
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from '../../auth';

export type SsoOperation = 'load' | 'create' | 'update' | 'addDomain' | 'verifyDomain' | 'test' | 'activate';

export type SsoErrorKey =
  | 'domainBlocklisted'
  | 'domainUnverified'
  | 'connectionState'
  | 'connectionStateTest'
  | 'connectionStateActivate'
  | 'conflict'
  | 'conflictProviderName'
  | 'conflictProviderNameReserved'
  | 'conflictDomain'
  | 'validation'
  | 'urlNotPublic'
  | 'idpRefused'
  | 'notFound'
  | 'organizationNotFound'
  | 'forbidden'
  | 'rateLimited'
  | 'unavailable'
  | 'unknown'
  | 'stepUpCancelled'
  | 'fieldSlug'
  | 'fieldProtocol'
  | 'fieldSecret'
  | 'fieldSecretMissing'
  | 'fieldDefaultOrgUnit'
  | 'fieldSamlMetadata'
  | 'fieldOidc'
  | 'fieldIdpInitiated';

/** Form fields a failure can point at (the ids of the create and edit forms' inputs). */
export type SsoField =
  | 'slug'
  | 'protocol'
  | 'metadataUrl'
  | 'metadataXml'
  | 'oidcIssuer'
  | 'oidcClientId'
  | 'oidcClientSecret'
  | 'defaultOrgUnitId'
  | 'domain';

export interface SsoProblem {
  key: SsoErrorKey;
  /** The form field to attach the message to; `null` for calls made outside a form. */
  field: SsoField | null;
}

const FORM_OPERATIONS: ReadonlySet<SsoOperation> = new Set(['create', 'update', 'addDomain']);

/** Why the API refuses a metadata URL or issuer: not https, no usable host, or a host that resolves to a non-public address. */
const NOT_PUBLIC_REASONS: ReadonlySet<string> = new Set(['scheme', 'host', 'private_address']);

const FORM_FIELDS: ReadonlySet<string> = new Set<SsoField>([
  'slug',
  'protocol',
  'metadataUrl',
  'metadataXml',
  'oidcIssuer',
  'oidcClientId',
  'oidcClientSecret',
  'defaultOrgUnitId',
  'domain',
]);

/** The field named by `details.field`, the first of `details.fields`, or the first issue path of a 400. */
function namedFields(details: Record<string, unknown> | undefined): { single: string | null; list: string[] } {
  if (!details) return { single: null, list: [] };
  const list = Array.isArray(details['fields']) ? details['fields'].filter((f): f is string => typeof f === 'string') : [];
  if (typeof details['field'] === 'string') return { single: details['field'], list };
  const issues = details['issues'];
  if (Array.isArray(issues)) {
    const path = (issues[0] as { path?: unknown } | undefined)?.path;
    if (Array.isArray(path) && typeof path[0] === 'string') return { single: path[0], list };
  }
  return { single: null, list };
}

function validationProblem(err: ApiError, op: SsoOperation): { key: SsoErrorKey; field: string | null } {
  const { single, list } = namedFields(err.details);
  if (list.includes('metadataUrl') || list.includes('metadataXml')) return { key: 'fieldSamlMetadata', field: 'metadataUrl' };
  if (list.includes('oidcIssuer') || list.includes('oidcClientId')) return { key: 'fieldOidc', field: 'oidcIssuer' };
  switch (single) {
    case 'slug':
      return { key: 'fieldSlug', field: 'slug' };
    case 'protocol':
      return { key: 'fieldProtocol', field: 'protocol' };
    case 'oidcClientSecret':
      return { key: op === 'test' ? 'fieldSecretMissing' : 'fieldSecret', field: 'oidcClientSecret' };
    case 'defaultOrgUnitId':
      return { key: 'fieldDefaultOrgUnit', field: 'defaultOrgUnitId' };
    case 'idpInitiatedAllowed':
      return { key: 'fieldIdpInitiated', field: null };
    case 'metadataUrl':
    case 'oidcIssuer': {
      const reason = err.details?.['reason'];
      return { key: typeof reason === 'string' && NOT_PUBLIC_REASONS.has(reason) ? 'urlNotPublic' : 'validation', field: single };
    }
    case null:
      // A 422 without a field is the identity provider refusing the configuration.
      return { key: err.status === 422 ? 'idpRefused' : 'validation', field: null };
    default:
      return { key: 'validation', field: single };
  }
}

function classify(err: ApiError, op: SsoOperation): { key: SsoErrorKey; field: string | null } {
  if (err.status === 429 || err.code === 'rate_limited') return { key: 'rateLimited', field: null };
  switch (err.code) {
    case 'domain_blocklisted':
      return { key: 'domainBlocklisted', field: 'domain' };
    case 'domain_unverified':
      return { key: 'domainUnverified', field: null };
    case 'sso_connection_state':
      if (op === 'test') return { key: 'connectionStateTest', field: null };
      if (op === 'activate') return { key: 'connectionStateActivate', field: null };
      return { key: 'connectionState', field: null };
    case 'validation':
      return validationProblem(err, op);
    case 'not_found':
      // On create the only lookup is the organization (`Organization not found`).
      return { key: op === 'create' ? 'organizationNotFound' : 'notFound', field: null };
    case 'forbidden':
      return { key: 'forbidden', field: null };
    case 'unavailable':
      return { key: 'unavailable', field: null };
  }
  if (err.code === 'conflict' || err.status === 409) {
    if (err.details?.['reason'] === 'provider_name_taken') {
      return { key: 'conflictProviderNameReserved', field: op === 'create' ? 'slug' : 'protocol' };
    }
    if (op === 'create') return { key: 'conflictProviderName', field: 'slug' };
    if (op === 'addDomain') return { key: 'conflictDomain', field: 'domain' };
    return { key: 'conflict', field: null };
  }
  if (err.status === 404) return { key: op === 'create' ? 'organizationNotFound' : 'notFound', field: null };
  if (err.status === 503) return { key: 'unavailable', field: null };
  return { key: 'unknown', field: null };
}

export function ssoProblem(err: unknown, op: SsoOperation): SsoProblem | null {
  if (err instanceof StepUpCancelledError) return op === 'load' ? { key: 'stepUpCancelled', field: null } : null;
  if (!(err instanceof ApiError)) return { key: 'unknown', field: null };
  const { key, field } = classify(err, op);
  const inForm = FORM_OPERATIONS.has(op) && field !== null && FORM_FIELDS.has(field);
  return { key, field: inForm ? (field as SsoField) : null };
}
