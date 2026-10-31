import { describe, it, expect } from 'vitest';
import { StepUpCancelledError } from '../../auth';
import { apiError, t } from '../organizations/ops-test-harness';
import { ssoProblem } from './sso-errors';
import type { SsoOperation } from './sso-errors';

describe('ssoProblem', () => {
  it.each<[ReturnType<typeof apiError> | Error, SsoOperation, string, string | null]>([
    [apiError(422, 'domain_blocklisted'), 'addDomain', 'domainBlocklisted', 'domain'],
    [apiError(422, 'domain_blocklisted'), 'verifyDomain', 'domainBlocklisted', null],
    [apiError(422, 'domain_unverified'), 'verifyDomain', 'domainUnverified', null],
    [apiError(409, 'sso_connection_state'), 'test', 'connectionStateTest', null],
    [apiError(409, 'sso_connection_state'), 'activate', 'connectionStateActivate', null],
    [apiError(409, 'sso_connection_state'), 'update', 'connectionState', null],
    [apiError(409, 'conflict'), 'create', 'conflictProviderName', 'slug'],
    [apiError(409, 'conflict'), 'addDomain', 'conflictDomain', 'domain'],
    [apiError(409, 'conflict'), 'update', 'conflict', null],
    [apiError(409, 'conflict', { reason: 'provider_name_taken', field: 'slug' }), 'create', 'conflictProviderNameReserved', 'slug'],
    [apiError(409, 'conflict', { reason: 'provider_name_taken', field: 'protocol' }), 'update', 'conflictProviderNameReserved', 'protocol'],
    [apiError(409, 'something_new'), 'update', 'conflict', null],
    [apiError(422, 'validation', { field: 'slug' }), 'create', 'fieldSlug', 'slug'],
    [apiError(422, 'validation', { field: 'slug', providerName: 'org-x-saml' }), 'create', 'fieldSlug', 'slug'],
    [apiError(422, 'validation', { field: 'protocol' }), 'update', 'fieldProtocol', 'protocol'],
    [apiError(422, 'validation', { field: 'oidcClientSecret' }), 'update', 'fieldSecret', 'oidcClientSecret'],
    [apiError(422, 'validation', { field: 'oidcClientSecret' }), 'test', 'fieldSecretMissing', null],
    [apiError(422, 'validation', { field: 'defaultOrgUnitId' }), 'create', 'fieldDefaultOrgUnit', 'defaultOrgUnitId'],
    [apiError(422, 'validation', { field: 'idpInitiatedAllowed' }), 'create', 'fieldIdpInitiated', null],
    [apiError(422, 'validation', { fields: ['metadataUrl', 'metadataXml'] }), 'test', 'fieldSamlMetadata', null],
    [apiError(422, 'validation', { fields: ['oidcIssuer', 'oidcClientId'] }), 'create', 'fieldOidc', 'oidcIssuer'],
    [apiError(422, 'validation', { field: 'metadataUrl', reason: 'scheme' }), 'create', 'urlNotPublic', 'metadataUrl'],
    [apiError(422, 'validation', { field: 'metadataUrl', reason: 'host' }), 'update', 'urlNotPublic', 'metadataUrl'],
    [apiError(422, 'validation', { field: 'metadataUrl', reason: 'private_address' }), 'create', 'urlNotPublic', 'metadataUrl'],
    [apiError(422, 'validation', { field: 'oidcIssuer', reason: 'scheme' }), 'create', 'urlNotPublic', 'oidcIssuer'],
    [apiError(422, 'validation', { field: 'oidcIssuer', reason: 'host' }), 'update', 'urlNotPublic', 'oidcIssuer'],
    [apiError(422, 'validation', { field: 'oidcIssuer', reason: 'private_address' }), 'update', 'urlNotPublic', 'oidcIssuer'],
    [apiError(422, 'validation', { field: 'metadataUrl', reason: 'private_address' }), 'test', 'urlNotPublic', null],
    [apiError(422, 'validation', { field: 'oidcIssuer', reason: 'host' }), 'test', 'urlNotPublic', null],
    [apiError(422, 'validation', { field: 'metadataUrl', reason: 'a_reason_added_later' }), 'create', 'validation', 'metadataUrl'],
    [apiError(422, 'validation', { field: 'metadataUrl' }), 'update', 'validation', 'metadataUrl'],
    [apiError(422, 'validation'), 'test', 'idpRefused', null],
    [apiError(400, 'validation'), 'create', 'validation', null],
    [apiError(400, 'validation', { issues: [{ path: ['metadataUrl'], message: 'Invalid url', code: 'invalid_string' }] }), 'create', 'validation', 'metadataUrl'],
    [apiError(404, 'not_found'), 'activate', 'notFound', null],
    [apiError(404, 'not_found'), 'create', 'organizationNotFound', null],
    [apiError(404, 'not_found'), 'update', 'notFound', null],
    [apiError(403, 'forbidden'), 'load', 'forbidden', null],
    [apiError(429, 'rate_limited'), 'test', 'rateLimited', null],
    [apiError(429, 'whatever'), 'test', 'rateLimited', null],
    [apiError(503, 'unavailable'), 'test', 'unavailable', null],
    [apiError(503, 'unavailable'), 'create', 'unavailable', null],
    [apiError(503, 'unavailable'), 'update', 'unavailable', null],
    [apiError(403, 'step_up_required'), 'activate', 'unknown', null],
    [apiError(500, 'internal'), 'load', 'unknown', null],
    [new Error('network'), 'load', 'unknown', null],
  ])('maps %s during %s to %s (field %s)', (err, op, key, field) => {
    expect(ssoProblem(err, op)).toEqual({ key, field });
  });

  it('words a refused address as the rule it broke', () => {
    expect(t('admin:sso.errors.urlNotPublic')).toBe('The address must be a public https URL.');
  });

  it('treats a cancelled step-up as nothing to show', () => {
    expect(ssoProblem(new StepUpCancelledError(), 'activate')).toBeNull();
  });

  it('names a cancelled step-up of the list read, which leaves the page without a list', () => {
    expect(ssoProblem(new StepUpCancelledError(), 'load')).toEqual({ key: 'stepUpCancelled', field: null });
  });
});
