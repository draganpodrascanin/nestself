/**
 * Connection quality thresholds and timing, defined once (CW-R-55c, CW-R-97).
 * `useConnectionQuality`, `ConnectionBadge` and the degraded-mode logic in
 * `CallSessionController` all read these values; change them here only.
 *
 * Values: guidelines 11.6 and 18.3, from UX research (UX-36, UX-38, UX-39).
 */
import type { CallQualityMetrics } from '@nestself/contracts';

/**
 * Three-state connection quality. `degraded` is the guidelines' "fair" and
 * the stories' "unstable" (CALL-09): one name in code, three labels in copy.
 */
export type ConnectionQuality = 'good' | 'degraded' | 'poor';

/**
 * Below `good` is good, above `poor` is poor, in between is degraded.
 * Bitrate runs the other way: above `good` is good, below `poor` is poor.
 */
export const QUALITY_THRESHOLDS = {
  rttMs: { good: 150, poor: 300 },
  jitterMs: { good: 30, poor: 60 },
  /** Fraction from 0 to 1, as in `CallQualityMetrics.packetLoss`. */
  packetLoss: { good: 0.01, poor: 0.02 },
  /** Available outgoing bitrate in bits per second. */
  outgoingBitrateBps: { good: 1_500_000, poor: 500_000 },
} as const;

/** `getStats()` samples are aggregated and classified this often (D-CW-13). */
export const QUALITY_AGGREGATION_INTERVAL_MS = 30_000;
/** Consecutive poor intervals before outgoing video pauses (60 seconds). */
export const POOR_INTERVALS_BEFORE_VIDEO_PAUSE = 2;
/** Fair-or-better for this long resumes paused outgoing video. */
export const QUALITY_RECOVERY_MS = 10_000;
/** The SDK's default reconnection window (CORE-17); the controller enforces it too. */
export const RECONNECT_TIMEOUT_MS = 120_000;

/** Outgoing video in degraded mode: 360p first, before pausing (guidelines 11.6). */
export const DEGRADED_VIDEO_QUALITY = { width: 640, height: 360, frameRate: 15 } as const;
/** The SDK's default outgoing video quality, restored after recovery. */
export const DEFAULT_VIDEO_QUALITY = { width: 960, height: 540, frameRate: 15 } as const;

function level(value: number | undefined, bounds: { good: number; poor: number }): ConnectionQuality {
  if (value === undefined) return 'good';
  if (value > bounds.poor) return 'poor';
  if (value >= bounds.good) return 'degraded';
  return 'good';
}

function bitrateLevel(value: number | undefined): ConnectionQuality {
  const bounds = QUALITY_THRESHOLDS.outgoingBitrateBps;
  if (value === undefined) return 'good';
  if (value < bounds.poor) return 'poor';
  if (value <= bounds.good) return 'degraded';
  return 'good';
}

const RANK: Record<ConnectionQuality, number> = { good: 0, degraded: 1, poor: 2 };

/** The worst level across the metrics that are present; missing metrics do not count. */
export function classifyQuality(metrics: CallQualityMetrics): ConnectionQuality {
  const levels: ConnectionQuality[] = [
    level(metrics.rtt, QUALITY_THRESHOLDS.rttMs),
    level(metrics.jitter, QUALITY_THRESHOLDS.jitterMs),
    level(metrics.packetLoss, QUALITY_THRESHOLDS.packetLoss),
    bitrateLevel(metrics.outgoingBitrate),
  ];
  return levels.reduce((worst, next) => (RANK[next] > RANK[worst] ? next : worst), 'good');
}

/** Mean of each metric over the samples that carry it. */
export function aggregateMetrics(samples: readonly CallQualityMetrics[]): CallQualityMetrics {
  const keys = ['rtt', 'jitter', 'packetLoss', 'outgoingBitrate'] as const;
  const out: CallQualityMetrics = {};
  for (const key of keys) {
    const values = samples.map((sample) => sample[key]).filter((value): value is number => value !== undefined);
    if (values.length) out[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return out;
}
