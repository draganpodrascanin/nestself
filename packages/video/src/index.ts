/**
 * `@nestself/video`: the web call client of NS-CALLS-01 (D-CW-20).
 * Explicit named exports only.
 */

// Controller and state
export { CallSessionController, loadChimeSdk } from './controller';
export type { CallSessionControllerOptions } from './controller';
export type {
  BlurState,
  CallEndReason,
  CallFailureReason,
  CallSessionControllerApi,
  CallSessionSnapshot,
  CallSessionStatus,
  CallSignal,
  DeviceCheckResult,
  DeviceKind,
  DeviceOption,
  DevicesState,
  MediaPermission,
  MediaState,
  NetworkCheckResult,
  QualityState,
  ReadinessState,
  RemoteTile,
  SessionState,
  SpeakerTestState,
  TilesState,
} from './types';

// Thresholds, preferences, environment
export {
  DEFAULT_VIDEO_QUALITY,
  DEGRADED_VIDEO_QUALITY,
  POOR_INTERVALS_BEFORE_VIDEO_PAUSE,
  QUALITY_AGGREGATION_INTERVAL_MS,
  QUALITY_RECOVERY_MS,
  QUALITY_THRESHOLDS,
  RECONNECT_TIMEOUT_MS,
  aggregateMetrics,
  classifyQuality,
} from './quality-thresholds';
export type { ConnectionQuality } from './quality-thresholds';
export {
  VIDEO_STORAGE_KEYS,
  createLocalPreferenceStore,
  createMemoryPreferenceStore,
  readDevicePreferences,
} from './preferences';
export type { DevicePreferences, PreferenceStore, VideoStorageKey } from './preferences';
export { detectBrowser, detectOs } from './environment';
export type { BrowserFamily, OsFamily } from './environment';

// Hooks
export { useCallSession } from './hooks/useCallSession';
export type { UseCallSessionOptions, UseCallSessionResult } from './hooks/useCallSession';
export { useDevices } from './hooks/useDevices';
export type { UseDevicesResult } from './hooks/useDevices';
export { useConnectionQuality } from './hooks/useConnectionQuality';
export type { UseConnectionQualityResult } from './hooks/useConnectionQuality';
export { useVideoTiles } from './hooks/useVideoTiles';
export type { UseVideoTilesResult } from './hooks/useVideoTiles';
export { useFullscreen } from './hooks/useFullscreen';

// Fake controller for stories, tests and sample mode
export { FakeCallSessionController } from './testing/fake-controller';
export type { FakeCallSessionControllerOptions } from './testing/fake-controller';
