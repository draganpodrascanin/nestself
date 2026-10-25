/**
 * Webinar failures as translated copy (T-CW-2.4, error-visibility rule): the
 * webinar codes, the webinar join window, the webinar state conflict, and a
 * fallback for anything unknown. Never the API's English message.
 */
import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import type { Resource, TFunction } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import { WEBINAR_REPLICATED_CAPACITY } from '@nestself/contracts';
import { isWebinarNotOpen, mapWebinarError } from './map-webinar-error';

const i18n = i18next.createInstance();
void i18n.init({ lng: 'en', resources: resourcesFor(['calls']) as Resource, interpolation: { escapeValue: false }, initAsync: false });
const t = i18n.getFixedT('en', 'calls') as unknown as TFunction<'calls'>;

const apiError = (code: string, status = 400) => new ApiError({ status, code, message: 'English developer message', requestId: null });

describe('mapWebinarError', () => {
  it.each([
    ['webinar_full', 'errors.webinarFull'],
    ['webinar_not_open', 'errors.webinarNotOpen'],
    ['registration_closed', 'errors.registrationClosed'],
    ['already_registered', 'errors.alreadyRegistered'],
    ['not_eligible', 'errors.notEligible'],
    ['floor_not_available', 'errors.floorNotAvailable'],
    ['recording_not_allowed', 'errors.recordingNotAllowed'],
    ['conflict', 'errors.conflict'],
    ['join_window_closed', 'webinar.errors.joinWindowClosed'],
  ])('maps %s to its copy', (code, key) => {
    expect(mapWebinarError(apiError(code, 409), t)).toBe(t(key));
  });

  it('names the limit for capacity_above_limit, without a milestone', () => {
    // No `details.limit` here: the mapper falls back to the replicated capacity (1,000 since T-CW-3.2).
    const message = mapWebinarError(apiError('capacity_above_limit'), t);
    expect(message).toContain(String(WEBINAR_REPLICATED_CAPACITY));
    expect(message).not.toContain('M3');
  });

  it('falls back to the unknown copy, never the developer message', () => {
    expect(mapWebinarError(apiError('something_new', 418), t)).toBe(t('errors.unknown'));
    expect(mapWebinarError(new Error('boom'), t)).toBe(t('errors.unknown'));
  });

  it('tells the lobby answer apart from a failure', () => {
    expect(isWebinarNotOpen(apiError('webinar_not_open', 409))).toBe(true);
    expect(isWebinarNotOpen(apiError('not_eligible', 403))).toBe(false);
  });
});
