/**
 * Device preferences remembered per device in `localStorage` (CALL-04,
 * D-CW-21). Every access is wrapped in try/catch: storage can be blocked
 * (private windows, cleared or blocked site data) and the call must work
 * without it. Only device ids and on/off choices are stored, never labels.
 */

export const VIDEO_STORAGE_KEYS = {
  camera: 'nestself.video.camera',
  microphone: 'nestself.video.microphone',
  speaker: 'nestself.video.speaker',
  cameraOff: 'nestself.video.cameraOff',
  blur: 'nestself.video.blur',
} as const;

export type VideoStorageKey = (typeof VIDEO_STORAGE_KEYS)[keyof typeof VIDEO_STORAGE_KEYS];

export interface PreferenceStore {
  get(key: VideoStorageKey): string | null;
  set(key: VideoStorageKey, value: string): void;
  remove(key: VideoStorageKey): void;
}

export interface DevicePreferences {
  camera: string | null;
  microphone: string | null;
  speaker: string | null;
  cameraOff: boolean;
  blur: boolean;
}

/** `window.localStorage`, failing soft. */
export function createLocalPreferenceStore(): PreferenceStore {
  const storage = (): Storage | null => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage()?.setItem(key, value);
      } catch {
        // Storage blocked or full: the preference lasts for this page only.
      }
    },
    remove(key) {
      try {
        storage()?.removeItem(key);
      } catch {
        // Storage blocked: nothing to remove.
      }
    },
  };
}

/** A store that lives in memory, for stories and tests. */
export function createMemoryPreferenceStore(initial: Partial<Record<VideoStorageKey, string>> = {}): PreferenceStore {
  const values = new Map<VideoStorageKey, string>(Object.entries(initial) as Array<[VideoStorageKey, string]>);
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  };
}

export function readDevicePreferences(store: PreferenceStore): DevicePreferences {
  return {
    camera: store.get(VIDEO_STORAGE_KEYS.camera),
    microphone: store.get(VIDEO_STORAGE_KEYS.microphone),
    speaker: store.get(VIDEO_STORAGE_KEYS.speaker),
    cameraOff: store.get(VIDEO_STORAGE_KEYS.cameraOff) === 'true',
    blur: store.get(VIDEO_STORAGE_KEYS.blur) === 'true',
  };
}
