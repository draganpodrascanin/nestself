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
export { useCallSessionController } from './hooks/useCallSessionController';
export type { UseCallSessionOptions, UseCallSessionResult } from './hooks/useCallSession';
export { useDevices } from './hooks/useDevices';
export type { UseDevicesResult } from './hooks/useDevices';
export { useConnectionQuality } from './hooks/useConnectionQuality';
export type { UseConnectionQualityResult } from './hooks/useConnectionQuality';
export { useVideoTiles } from './hooks/useVideoTiles';
export type { UseVideoTilesResult } from './hooks/useVideoTiles';
export { useFullscreen } from './hooks/useFullscreen';

// Components
export { PreJoinCheck } from './components/PreJoinCheck';
export type { PreJoinCheckProps } from './components/PreJoinCheck';
export { CallStage } from './components/CallStage';
export type { CallStageProps, SelfViewCorner } from './components/CallStage';
export { ControlBar, CONTROL_BAR_WIDE_QUERY } from './components/ControlBar';
export type { ControlBarProps } from './components/ControlBar';
export { ConnectionBadge } from './components/ConnectionBadge';
export type { ConnectionBadgeProps } from './components/ConnectionBadge';
export { SessionTimer } from './components/SessionTimer';
export { formatClock } from './components/format-clock';
export type { SessionTimerProps } from './components/SessionTimer';
export { CrisisBlock, CrisisResourcesButton } from './components/CrisisBlock';
export { SERBIA_CRISIS_LINES } from './components/crisis-lines';
export type { CrisisAudience, CrisisBlockProps, CrisisResourcesButtonProps } from './components/CrisisBlock';
export { FollowUpCard } from './components/FollowUpCard';
export type {
  EmployeeFollowUpCardProps,
  EmployeeFollowUpStatus,
  ExpertFollowUpCardProps,
  ExpertFollowUpStatus,
  FollowUpCardProps,
  FollowUpProposal,
} from './components/FollowUpCard';
export { formatInZone, zonedDateTimeToIso } from './time-zone';

// Fake controller for stories, tests and sample mode
export { FakeCallSessionController } from './testing/fake-controller';
export type { FakeCallSessionControllerOptions } from './testing/fake-controller';

// Webinar client (T-CW-2.3): state, transport contract and coded errors
export { WebinarClient } from './webinar/client';
export type { WebinarClientOptions } from './webinar/client';
export { WebinarActionError, toWebinarActionError, webinarErrorMessage } from './webinar/errors';
export { WEBINAR_ACTIONS, WEBINAR_ACTION_ROUTES } from './webinar/types';
export type {
  WebinarAction,
  WebinarActionArea,
  WebinarActionErrorLike,
  WebinarActionInputs,
  WebinarAudioControl,
  WebinarClientApi,
  WebinarFloorState,
  WebinarHand,
  WebinarHandState,
  WebinarInitialState,
  WebinarPollsState,
  WebinarRoomHandler,
  WebinarSnapshot,
  WebinarSpeaker,
  WebinarTransport,
  WebinarViewerRole,
} from './webinar/types';
export { useWebinarStage } from './hooks/useWebinarStage';
export type { UseWebinarStageResult } from './hooks/useWebinarStage';

// Webinar components
export { WebinarStage } from './components/WebinarStage';
export type { WebinarStageProps } from './components/WebinarStage';
export { ChatPanel } from './components/ChatPanel';
export type { ChatPanelProps } from './components/ChatPanel';
export { PollPanel } from './components/PollPanel';
export type { PollPanelProps } from './components/PollPanel';
export { ModeratorQueue } from './components/ModeratorQueue';
export type { ModeratorQueueProps } from './components/ModeratorQueue';
export { HandRaiseButton } from './components/HandRaiseButton';
export type { HandRaiseButtonProps } from './components/HandRaiseButton';
export { FloorGrantedDialog, FloorTakenNotice } from './components/FloorGrantedDialog';
export type { FloorGrantedDialogProps, FloorTakenNoticeProps } from './components/FloorGrantedDialog';

// Fake webinar for stories, tests and sample mode
export { FakeWebinarClient, FakeWebinarServer } from './testing/fake-webinar';
export type {
  FakeWebinarClientOptions,
  FakeWebinarEmission,
  FakeWebinarIdentity,
  FakeWebinarRequest,
  FakeWebinarServerOptions,
} from './testing/fake-webinar';
export { FAKE_WEBINAR_SAMPLE_PEOPLE, FAKE_WEBINAR_SAMPLE_POLL, createSampleWebinarServer } from './testing/fake-webinar-sample';
export type { FakeWebinarSampleOptions } from './testing/fake-webinar-sample';
