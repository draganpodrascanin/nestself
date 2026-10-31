import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import type { Resource, TFunction } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import { CALL_ERROR_CODES, WEBINAR_REPLICATED_CAPACITY } from '@nestself/contracts';
import { CALL_ERROR_MESSAGES, mapCallError } from './map-call-error';

const i18n = i18next.createInstance();
void i18n.init({ lng: 'en', resources: resourcesFor(['calls']) as Resource, interpolation: { escapeValue: false }, initAsync: false });
const t = i18n.getFixedT('en', 'calls') as unknown as TFunction<'calls'>;

const apiError = (code: string, status = 400) => new ApiError({ status, code, message: 'English developer message', requestId: null });

describe('mapCallError', () => {
  it('has a mapping for every call error code (CW-R-60)', () => {
    for (const code of CALL_ERROR_CODES) expect(CALL_ERROR_MESSAGES[code], code).toBeTypeOf('function');
  });

  it('maps not_editable (a webinar past its draft stage) to its copy', () => {
    expect(mapCallError(apiError('not_editable', 409), t)).toBe(t('errors.notEditable'));
  });

  it.each(CALL_ERROR_CODES)('maps %s to its own translated copy', (code) => {
    const message = mapCallError(apiError(code), t);
    expect(message).not.toBe(t('errors.unknown'));
    expect(message).not.toMatch(/^errors\./);
    expect(message).not.toContain('English developer message');
  });

  it('maps join_window_closed and appointment_not_joinable to their copy', () => {
    expect(mapCallError(apiError('join_window_closed', 403), t)).toBe(t('errors.joinWindowClosed'));
    expect(mapCallError(apiError('appointment_not_joinable', 409), t)).toBe(t('errors.appointmentNotJoinable'));
  });

  it("interpolates the server's limit for capacity_above_limit, else the replicated capacity", () => {
    const withLimit = new ApiError({ status: 400, code: 'capacity_above_limit', message: 'English', requestId: null, details: { limit: 750 } });
    expect(mapCallError(withLimit, t)).toContain('750');
    expect(mapCallError(apiError('capacity_above_limit'), t)).toContain(String(WEBINAR_REPLICATED_CAPACITY));
  });

  it('maps generic codes and statuses', () => {
    expect(mapCallError(apiError('network', 0), t)).toBe(t('errors.network'));
    expect(mapCallError(apiError('not_found', 404), t)).toBe(t('errors.notFound'));
    expect(mapCallError(apiError('something_new', 404), t)).toBe(t('errors.notFound'));
    expect(mapCallError(apiError('rate_limited', 429), t)).toBe(t('errors.rateLimited'));
    expect(mapCallError(apiError('forbidden', 403), t)).toBe(t('errors.forbidden'));
    expect(mapCallError(apiError('validation', 400), t)).toBe(t('errors.validation'));
    expect(mapCallError(apiError('conflict', 409), t)).toBe(t('errors.conflict'));
    expect(mapCallError(apiError('unauthenticated', 401), t)).toBe(t('errors.sessionExpired'));
    expect(mapCallError(apiError('session_expired', 401), t)).toBe(t('errors.sessionExpired'));
  });

  it('falls back to errors.unknown for an unknown code or a non-API error', () => {
    expect(mapCallError(apiError('brand_new_code', 500), t)).toBe(t('errors.unknown'));
    expect(mapCallError(new Error('boom'), t)).toBe(t('errors.unknown'));
    expect(t('errors.unknown')).toBe('Something went wrong. Please try again.');
  });
});
