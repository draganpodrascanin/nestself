import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@nestself/api-client';
import { mapLibraryError, mapSaveError } from './map-library-error';

function mockT(key: string) {
  return key;
}

describe('mapLibraryError', () => {
  const t = vi.fn(mockT) as unknown as Parameters<typeof mapLibraryError>[1];

  it('maps content_not_available to the correct key', () => {
    const err = new ApiError({ status: 404, code: 'content_not_available', message: '', requestId: null });
    expect(mapLibraryError(err, t)).toBe('error.contentNotAvailable');
  });

  it('maps invalid_context to the correct key', () => {
    const err = new ApiError({ status: 400, code: 'invalid_context', message: '', requestId: null });
    expect(mapLibraryError(err, t)).toBe('error.invalidContext');
  });

  it('maps network error to the correct key', () => {
    const err = new ApiError({ status: 0, code: 'network', message: '', requestId: null });
    expect(mapLibraryError(err, t)).toBe('error.network');
  });

  it('maps org_context_expired to the correct key', () => {
    const err = new ApiError({ status: 403, code: 'org_context_expired', message: '', requestId: null });
    expect(mapLibraryError(err, t)).toBe('error.orgContextExpired');
  });

  it('maps unknown ApiError code to error.unknown', () => {
    const err = new ApiError({ status: 500, code: 'server_error', message: '', requestId: null });
    expect(mapLibraryError(err, t)).toBe('error.unknown');
  });

  it('maps non-ApiError to error.unknown', () => {
    expect(mapLibraryError(new Error('random'), t)).toBe('error.unknown');
  });
});

describe('mapSaveError', () => {
  const t = vi.fn(mockT) as unknown as Parameters<typeof mapSaveError>[1];

  it('maps content_not_available on save', () => {
    const err = new ApiError({ status: 404, code: 'content_not_available', message: '', requestId: null });
    expect(mapSaveError(err, t, 'save')).toBe('error.contentNotAvailable');
  });

  it('maps org_context_expired on unsave', () => {
    const err = new ApiError({ status: 403, code: 'org_context_expired', message: '', requestId: null });
    expect(mapSaveError(err, t, 'unsave')).toBe('error.orgContextExpired');
  });

  it('maps network error on save', () => {
    const err = new ApiError({ status: 0, code: 'network', message: '', requestId: null });
    expect(mapSaveError(err, t, 'save')).toBe('error.network');
  });

  it('falls back to error.saveFailed for unknown API code on save', () => {
    const err = new ApiError({ status: 500, code: 'server_error', message: '', requestId: null });
    expect(mapSaveError(err, t, 'save')).toBe('error.saveFailed');
  });

  it('falls back to error.unsaveFailed for unknown API code on unsave', () => {
    const err = new ApiError({ status: 500, code: 'server_error', message: '', requestId: null });
    expect(mapSaveError(err, t, 'unsave')).toBe('error.unsaveFailed');
  });

  it('falls back to error.saveFailed for non-ApiError on save', () => {
    expect(mapSaveError(new TypeError('fetch failed'), t, 'save')).toBe('error.saveFailed');
  });

  it('falls back to error.unsaveFailed for non-ApiError on unsave', () => {
    expect(mapSaveError(new TypeError('fetch failed'), t, 'unsave')).toBe('error.unsaveFailed');
  });
});
