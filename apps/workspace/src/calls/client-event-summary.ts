/**
 * What the "Report a technical problem" form attaches (CALL-16): call
 * length, reconnections, the last connection aggregate, browser and OS.
 * Built from the client events of D-CW-13, so it holds connection metadata
 * only: never names, device labels or anything said.
 */
import type { CallProblemSummary, CallQualityMetrics, ClientEventRequest } from '@nestself/contracts';

export interface ClientEventSummary {
  durationMs: number | null;
  reconnects: number;
  metrics: CallQualityMetrics | null;
  browser: string | null;
  os: string | null;
}

export class ClientEventSummaryRecorder {
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private reconnects = 0;
  private metrics: CallQualityMetrics | null = null;
  private browser: string | null = null;
  private os: string | null = null;

  started(at: number = Date.now()): void {
    this.startedAt ??= at;
  }

  ended(at: number = Date.now()): void {
    if (this.startedAt !== null) this.endedAt ??= at;
  }

  add(events: readonly ClientEventRequest[]): void {
    for (const event of events) {
      if (event.eventName === 'meetingReconnected') this.reconnects += 1;
      if (event.eventName === 'connectionStats' && event.metrics) this.metrics = event.metrics;
      this.browser = event.browser ?? this.browser;
      this.os = event.os ?? this.os;
    }
  }

  summary(now: number = Date.now()): ClientEventSummary {
    const end = this.endedAt ?? now;
    return {
      durationMs: this.startedAt === null ? null : Math.max(0, end - this.startedAt),
      reconnects: this.reconnects,
      metrics: this.metrics,
      browser: this.browser,
      os: this.os,
    };
  }

  /**
   * The `summary` of `POST /calls/:sessionId/problem-report` (CALL-16): the
   * strict connection summary, with only the fields that were measured.
   */
  problemSummary(now: number = Date.now()): CallProblemSummary {
    const { durationMs, reconnects, metrics, browser, os } = this.summary(now);
    return {
      ...(durationMs !== null ? { durationMs: Math.round(durationMs) } : {}),
      reconnectCount: reconnects,
      ...(metrics ? { metrics } : {}),
      ...(browser ? { browser } : {}),
      ...(os ? { os } : {}),
    };
  }
}
