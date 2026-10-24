import { describe, expect, it } from 'vitest';
import {
  QUALITY_AGGREGATION_INTERVAL_MS,
  QUALITY_RECOVERY_MS,
  QUALITY_THRESHOLDS,
  RECONNECT_TIMEOUT_MS,
  aggregateMetrics,
  classifyQuality,
} from './quality-thresholds';

describe('quality thresholds (guidelines 11.6, 18.3)', () => {
  it('uses the research values as constants', () => {
    expect(QUALITY_THRESHOLDS.rttMs).toEqual({ good: 150, poor: 300 });
    expect(QUALITY_THRESHOLDS.jitterMs).toEqual({ good: 30, poor: 60 });
    expect(QUALITY_THRESHOLDS.packetLoss).toEqual({ good: 0.01, poor: 0.02 });
    expect(QUALITY_THRESHOLDS.outgoingBitrateBps).toEqual({ good: 1_500_000, poor: 500_000 });
    expect(QUALITY_AGGREGATION_INTERVAL_MS).toBe(30_000);
    expect(QUALITY_RECOVERY_MS).toBe(10_000);
    expect(RECONNECT_TIMEOUT_MS).toBe(120_000);
  });

  it('is good when every metric is under the good bound', () => {
    expect(classifyQuality({ rtt: 80, jitter: 10, packetLoss: 0.002, outgoingBitrate: 2_000_000 })).toBe('good');
  });

  it('is degraded between the bounds', () => {
    expect(classifyQuality({ rtt: 200 })).toBe('degraded');
    expect(classifyQuality({ jitter: 45 })).toBe('degraded');
    expect(classifyQuality({ packetLoss: 0.015 })).toBe('degraded');
    expect(classifyQuality({ outgoingBitrate: 1_000_000 })).toBe('degraded');
  });

  it('is poor above any poor bound', () => {
    expect(classifyQuality({ rtt: 301, jitter: 5 })).toBe('poor');
    expect(classifyQuality({ jitter: 61 })).toBe('poor');
    expect(classifyQuality({ packetLoss: 0.03 })).toBe('poor');
    expect(classifyQuality({ outgoingBitrate: 400_000 })).toBe('poor');
  });

  it('treats missing metrics as unknown, not as bad', () => {
    expect(classifyQuality({})).toBe('good');
  });

  it('averages samples per metric and ignores missing values', () => {
    expect(
      aggregateMetrics([
        { rtt: 100, jitter: 10 },
        { rtt: 200, packetLoss: 0.02 },
        { rtt: 300, jitter: 30, outgoingBitrate: 1_000_000 },
      ]),
    ).toEqual({ rtt: 200, jitter: 20, packetLoss: 0.02, outgoingBitrate: 1_000_000 });
    expect(aggregateMetrics([])).toEqual({});
  });
});
