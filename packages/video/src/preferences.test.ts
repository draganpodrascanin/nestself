import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIDEO_STORAGE_KEYS, createLocalPreferenceStore, createMemoryPreferenceStore, readDevicePreferences } from './preferences';
import { detectBrowser, detectOs } from './environment';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('device preferences (CALL-04, D-CW-21)', () => {
  it('uses the nestself.video.* keys', () => {
    expect(VIDEO_STORAGE_KEYS).toEqual({
      camera: 'nestself.video.camera',
      microphone: 'nestself.video.microphone',
      speaker: 'nestself.video.speaker',
      cameraOff: 'nestself.video.cameraOff',
      blur: 'nestself.video.blur',
    });
  });

  it('reads and writes localStorage', () => {
    const store = createLocalPreferenceStore();
    store.set(VIDEO_STORAGE_KEYS.camera, 'cam-2');
    store.set(VIDEO_STORAGE_KEYS.cameraOff, 'true');
    expect(window.localStorage.getItem('nestself.video.camera')).toBe('cam-2');
    expect(readDevicePreferences(store)).toEqual({
      camera: 'cam-2',
      microphone: null,
      speaker: null,
      cameraOff: true,
      blur: false,
    });
  });

  it('survives a storage that throws (private mode, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const store = createLocalPreferenceStore();
    expect(() => store.set(VIDEO_STORAGE_KEYS.blur, 'true')).not.toThrow();
    expect(store.get(VIDEO_STORAGE_KEYS.blur)).toBeNull();
  });

  it('has an in-memory store for stories and tests', () => {
    const store = createMemoryPreferenceStore({ [VIDEO_STORAGE_KEYS.blur]: 'true' });
    expect(readDevicePreferences(store).blur).toBe(true);
    store.remove(VIDEO_STORAGE_KEYS.blur);
    expect(readDevicePreferences(store).blur).toBe(false);
  });
});

describe('environment detection (coarse names only, D-CW-13)', () => {
  const ua = {
    chrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    safari:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    android:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  };

  it('detects the browser family', () => {
    expect(detectBrowser(ua.chrome)).toBe('chrome');
    expect(detectBrowser(ua.edge)).toBe('edge');
    expect(detectBrowser(ua.firefox)).toBe('firefox');
    expect(detectBrowser(ua.safari)).toBe('safari');
    expect(detectBrowser('curl/8')).toBe('other');
  });

  it('detects the operating system family', () => {
    expect(detectOs(ua.chrome)).toBe('macos');
    expect(detectOs(ua.edge)).toBe('windows');
    expect(detectOs(ua.firefox)).toBe('linux');
    expect(detectOs(ua.safari)).toBe('ios');
    expect(detectOs(ua.android)).toBe('android');
  });
});
