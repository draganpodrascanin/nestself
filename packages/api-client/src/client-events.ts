/**
 * Posts the call controller's client-event log (D-CW-13) every 30 seconds
 * and once more when the person leaves. Telemetry is background work: a
 * failed post is reported to `onError` and the batch is dropped, never
 * retried in a loop and never shown as an error the person caused.
 */
import type { ClientEventRequest } from '@nestself/contracts';

/** The cadence of the `getStats()` aggregate, so each post carries about one. */
export const CLIENT_EVENT_POST_INTERVAL_MS = 30_000;

export interface ClientEventPosterOptions {
  /** Returns the buffered events and clears the buffer (`controller.drainClientEvents`). */
  drain: () => ClientEventRequest[];
  /** Sends the events (`callsApi.postClientEvents(sessionId, events)`, which batches by 50). */
  post: (events: ClientEventRequest[]) => Promise<void>;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export interface ClientEventPoster {
  /** Posts whatever is buffered now. */
  flush(): Promise<void>;
  /** Stops the timer and posts the remainder. */
  stop(): Promise<void>;
}

export function startClientEventPoster({
  drain,
  post,
  intervalMs = CLIENT_EVENT_POST_INTERVAL_MS,
  onError,
}: ClientEventPosterOptions): ClientEventPoster {
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    const events = drain();
    if (events.length === 0) return inFlight;
    inFlight = inFlight.then(() => post(events)).catch((error: unknown) => onError?.(error));
    return inFlight;
  };

  const timer = setInterval(() => void flush(), intervalMs);

  return {
    flush,
    stop: () => {
      if (stopped) return inFlight;
      stopped = true;
      clearInterval(timer);
      return flush();
    },
  };
}
