/**
 * VideoMetrics (T-CW-1.2, D-CW-13): CloudWatch embedded metric format lines
 * for the `NestSelf/Video` alarms of the video stack.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { VIDEO_METRICS_NAMESPACE, VideoMetrics, videoMetricDocument } from './video-metrics.js';

describe('videoMetricDocument (embedded metric format)', () => {
  it('declares the namespace, the Stage dimension, the metric name and unit, and carries the value at the root', () => {
    expect(videoMetricDocument('JoinAttempts', 1, 'dev', 1_792_900_000_000)).toEqual({
      _aws: {
        Timestamp: 1_792_900_000_000,
        CloudWatchMetrics: [
          {
            Namespace: 'NestSelf/Video',
            Dimensions: [['Stage']],
            Metrics: [{ Name: 'JoinAttempts', Unit: 'Count' }],
          },
        ],
      },
      Stage: 'dev',
      JoinAttempts: 1,
    });
    expect(VIDEO_METRICS_NAMESPACE).toBe('NestSelf/Video');
  });

  it('uses Count for the counters and Milliseconds for the start duration', () => {
    const unit = (name: Parameters<typeof videoMetricDocument>[0]) =>
      videoMetricDocument(name, 1, 'prod')._aws.CloudWatchMetrics[0]!.Metrics[0]!.Unit;
    expect(unit('JoinAttempts')).toBe('Count');
    expect(unit('JoinFailures')).toBe('Count');
    expect(unit('MeetingFailed')).toBe('Count');
    expect(unit('MeetingStartDurationMs')).toBe('Milliseconds');
  });
});

describe('VideoMetrics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function capture(stage: string | undefined) {
    const lines: unknown[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      lines.push(message);
    });
    const metrics = new VideoMetrics({ get: (key: string) => (key === 'STAGE' ? stage : undefined) } as never);
    return { lines, metrics };
  }

  it('writes one EMF document per data point with the STAGE dimension', () => {
    const { lines, metrics } = capture('staging');
    metrics.joinAttempt();
    metrics.joinFailure();
    metrics.meetingStartDuration(1234.6);
    metrics.meetingFailed();

    expect(lines).toHaveLength(4);
    expect(lines.map((line) => (line as { Stage: string }).Stage)).toEqual(['staging', 'staging', 'staging', 'staging']);
    expect(lines[0]).toMatchObject({ JoinAttempts: 1 });
    expect(lines[1]).toMatchObject({ JoinFailures: 1 });
    expect(lines[2]).toMatchObject({ MeetingStartDurationMs: 1235 });
    expect(lines[3]).toMatchObject({ MeetingFailed: 1 });
    for (const line of lines) {
      expect((line as { _aws: { CloudWatchMetrics: { Namespace: string }[] } })._aws.CloudWatchMetrics[0]!.Namespace).toBe(
        'NestSelf/Video',
      );
      // One JSON line each, so the log driver forwards it whole.
      expect(JSON.stringify(line)).not.toContain('\n');
    }
  });

  it('defaults the stage to dev and never throws when the logger fails', () => {
    const { lines, metrics } = capture(undefined);
    metrics.joinAttempt();
    expect(lines[0]).toMatchObject({ Stage: 'dev' });

    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {
      throw new Error('stdout closed');
    });
    expect(() => metrics.meetingFailed()).not.toThrow();
  });
});
