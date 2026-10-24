import { describe, expect, it } from 'vitest';
// Every error code in the contracts needs copy: a new code cannot ship without it.
import { CALL_ERROR_CODES } from '@nestself/contracts';
import en from '../locales/en/calls.json';
import hu from '../locales/hu/calls.json';
import srCyrl from '../locales/sr-Cyrl/calls.json';
import srLatn from '../locales/sr-Latn/calls.json';
import { resources } from './resources';
import { locales, namespaces } from './types';

const catalogs = { en, 'sr-Latn': srLatn, 'sr-Cyrl': srCyrl, hu } as const;

const camelCase = (code: string) => code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** Keys the skeleton must carry (decision record section 7, T-CW-0.7). */
const REQUIRED_KEYS: Readonly<Record<string, readonly string[]>> = {
  consultation: [
    'join',
    'leave',
    'end',
    'waiting',
    'reconnecting',
    'connectionLost',
    'sessionEnded',
    'fiveMinutesRemaining',
  ],
  followUp: [
    'proposed',
    'confirm',
    'suggestTimes',
    'decline',
    'schedule',
    'awaitingApproval',
    'approved',
    'rejected',
    'reminderSubject',
    'proposedEmailSubject',
    'proposedEmailBody',
  ],
  approval: [
    'pending',
    'approved',
    'rejected',
    'expired',
    'decide',
    'reason',
    'missingApprover',
    'remind',
    'policyAutomatic',
    'policyManagerApproval',
  ],
  webinar: [
    'register',
    'unregister',
    'join',
    'lobby',
    'started',
    'ended',
    'recording',
    'recordingNotice',
    'recordingNoticeFloor',
    'messageSubmitted',
    'messagePublished',
    'floorGiven',
    'floorTaken',
    'youCanSpeakNow',
    'capacityAboveLimit',
  ],
  workshop: ['join', 'leave'],
  prejoin: ['checkingDevices', 'cameraOff', 'joinNow', 'permissionHelp'],
  email: ['reminderSubject', 'registrationSubject', 'followUpProposedSubject'],
};

function flatten(obj: object, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') Object.assign(out, flatten(value as object, path));
    else out[path] = value;
  }
  return out;
}

describe('calls namespace', () => {
  it('camel-cases error codes', () => {
    expect(camelCase('join_window_closed')).toBe('joinWindowClosed');
    expect(camelCase('invalid_ticket')).toBe('invalidTicket');
  });

  it.each(locales)('has copy for every CALL_ERROR_CODES code, plus unknown, in %s', (locale) => {
    const errors: Record<string, unknown> = catalogs[locale].errors;
    for (const code of CALL_ERROR_CODES) {
      const value = errors[camelCase(code)];
      expect(typeof value, `errors.${camelCase(code)} for ${code}`).toBe('string');
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
    expect(typeof errors.unknown).toBe('string');
  });

  it('has no error key that is not a call error code or unknown', () => {
    const expected = [...CALL_ERROR_CODES.map(camelCase), 'unknown'].sort();
    expect(Object.keys(en.errors).sort()).toEqual(expected);
  });

  it('carries every skeleton key in English', () => {
    const flat = flatten(en);
    for (const [group, keys] of Object.entries(REQUIRED_KEYS)) {
      for (const key of keys) expect(typeof flat[`${group}.${key}`], `${group}.${key}`).toBe('string');
    }
  });

  it('says the webinar is recorded and that only the presenters are on the recording', () => {
    expect(en.webinar.recordingNotice).toMatch(/recorded/i);
    expect(en.webinar.recordingNotice).toMatch(/only the presenters/i);
  });

  it('tells attendees in the lobby that the camera stays off and how to reach the hosts', () => {
    expect(en.webinar.lobby).toMatch(/camera stays off/i);
    expect(en.webinar.lobby).toMatch(/write to the hosts/i);
    expect(en.webinar.lobby).toMatch(/raise your hand/i);
  });

  it('makes no availability promise or privacy guarantee', () => {
    const text = Object.values(flatten(en)).join(' ').toLowerCase();
    for (const phrase of ['end-to-end', 'end to end', '24/7', 'guarantee', 'always available', 'within an hour']) {
      expect(text).not.toContain(phrase);
    }
  });

  it('is registered as a namespace with a catalog in every locale', () => {
    expect(namespaces).toContain('calls');
    for (const locale of locales) expect(resources[locale].calls).toEqual(catalogs[locale]);
  });
});
