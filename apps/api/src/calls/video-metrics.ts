/**
 * VideoMetrics: the `NestSelf/Video` metrics the video stack's D-CW-13 alarms
 * read (T-CW-1.2, `infra/cdk/lib/video-stack.ts`), with a `Stage` dimension
 * from `STAGE`:
 *
 * - `JoinAttempts` (Count): a join that passed the participant, status and
 *   window checks and asks for media credentials.
 * - `JoinFailures` (Count): such a join that then failed.
 * - `MeetingStartDurationMs` (Milliseconds): the provider's create latency
 *   (`CreateMeetingWithAttendees`).
 * - `MeetingFailed` (Count): the provider's create failed.
 *
 * Each data point is one CloudWatch embedded metric format document written
 * through the logger as a single JSON line; the ECS log driver forwards it
 * and CloudWatch Logs extracts the metric, so no SDK and no extra request is
 * needed. Emitting never throws: a lost data point must not fail a join.
 * The documents carry the stage and the value only, never an id.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';

/** Same namespace as `VIDEO_METRICS_NAMESPACE` in the video stack. */
export const VIDEO_METRICS_NAMESPACE = 'NestSelf/Video';

const METRIC_UNITS = {
  JoinAttempts: 'Count',
  JoinFailures: 'Count',
  MeetingStartDurationMs: 'Milliseconds',
  MeetingFailed: 'Count',
} as const;

export type VideoMetricName = keyof typeof METRIC_UNITS;

/** One embedded metric format document (CloudWatch EMF specification). */
export interface VideoMetricDocument {
  _aws: {
    Timestamp: number;
    CloudWatchMetrics: {
      Namespace: string;
      Dimensions: string[][];
      Metrics: { Name: VideoMetricName; Unit: (typeof METRIC_UNITS)[VideoMetricName] }[];
    }[];
  };
  Stage: string;
  [metric: string]: unknown;
}

/** The EMF document of one data point. */
export function videoMetricDocument(
  name: VideoMetricName,
  value: number,
  stage: string,
  timestamp: number = Date.now(),
): VideoMetricDocument {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: VIDEO_METRICS_NAMESPACE,
          Dimensions: [['Stage']],
          Metrics: [{ Name: name, Unit: METRIC_UNITS[name] }],
        },
      ],
    },
    Stage: stage,
    [name]: value,
  };
}

@Injectable()
export class VideoMetrics {
  private readonly logger = new Logger(VideoMetrics.name);
  private readonly stage: string;

  constructor(config: ConfigService) {
    this.stage = config.get<string>('STAGE') || 'dev';
  }

  joinAttempt(): void {
    this.put('JoinAttempts', 1);
  }

  joinFailure(): void {
    this.put('JoinFailures', 1);
  }

  meetingStartDuration(ms: number): void {
    this.put('MeetingStartDurationMs', Math.max(0, Math.round(ms)));
  }

  meetingFailed(): void {
    this.put('MeetingFailed', 1);
  }

  private put(name: VideoMetricName, value: number): void {
    try {
      this.logger.log(videoMetricDocument(name, value, this.stage));
    } catch {
      // A lost data point never fails the request that produced it.
    }
  }
}
