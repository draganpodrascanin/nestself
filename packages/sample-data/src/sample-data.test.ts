import { describe, it, expect } from 'vitest';
import {
  SAMPLE_ORG,
  SAMPLE_TEAMS,
  SAMPLE_PEOPLE,
  SAMPLE_SESSIONS,
  SAMPLE_CHANNELS,
  SAMPLE_POSTS,
  SAMPLE_POLLS,
  SAMPLE_EXPERTS,
  SAMPLE_CONTENT,
  SAMPLE_BOOKING,
  SAMPLE_HR_PROGRAMME,
  SAMPLE_EVENT_REQUEST,
  isSampleMode,
  assertNotProduction,
} from './index';

describe('sample-data fixtures', () => {
  const allFixtures: ReadonlyArray<object> = [
    SAMPLE_ORG,
    ...SAMPLE_TEAMS,
    ...SAMPLE_PEOPLE,
    ...SAMPLE_CHANNELS,
    ...SAMPLE_POSTS,
    ...SAMPLE_POLLS,
    ...SAMPLE_EXPERTS,
    ...SAMPLE_CONTENT,
    SAMPLE_BOOKING,
    SAMPLE_HR_PROGRAMME,
    SAMPLE_EVENT_REQUEST,
  ];

  it('every fixture has sample === true', () => {
    for (const obj of allFixtures) {
      expect(obj).toHaveProperty('sample', true);
    }
  });

  it('no fixture object has a portrait or photo value other than null', () => {
    for (const obj of allFixtures) {
      if ('portrait' in obj) {
        expect((obj as { portrait: unknown }).portrait).toBeNull();
      }
      if ('photo' in obj) {
        expect((obj as { photo: unknown }).photo).toBeNull();
      }
    }
  });

  it('SAMPLE_SESSIONS.hr_admin.orgRole === "hr_admin"', () => {
    expect(SAMPLE_SESSIONS.hr_admin.orgRole).toBe('hr_admin');
  });
});

describe('sample-data mode helpers', () => {
  it('isSampleMode returns true when VITE_DATA_SOURCE is "sample"', () => {
    expect(isSampleMode({ VITE_DATA_SOURCE: 'sample' })).toBe(true);
  });

  it('isSampleMode returns true when EXPO_PUBLIC_DATA_SOURCE is "sample"', () => {
    expect(isSampleMode({ EXPO_PUBLIC_DATA_SOURCE: 'sample' })).toBe(true);
  });

  it('isSampleMode returns false for empty env', () => {
    expect(isSampleMode({})).toBe(false);
  });

  it('assertNotProduction throws when NODE_ENV is "production"', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'production' })).toThrow();
  });

  it('assertNotProduction does not throw for other NODE_ENV values', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertNotProduction({})).not.toThrow();
  });
});
