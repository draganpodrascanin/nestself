/**
 * WebinarJobsService: what the `nestself-webinars` jobs do (T-CW-2.1); the
 * worker passes it to `WebinarJobSchedulerService.start()`.
 *
 * - `webinar.remind` (WBN-05, D-CW-26): re-reads the registration and the
 *   occurrence (CW-R-37) and sends the `webinar.reminder` email only while
 *   the registration is active, the occurrence `published` or `live` and
 *   not yet started; otherwise it exits without action.
 * - `webinar.recording.start` (CW-R-107, CW-R-121) and
 *   `webinar.recording.finalize` (CW-R-79d, CW-R-79e): the recording
 *   pipeline of `WebinarRecordingService` (T-CW-2.5), with the run's attempt
 *   context for its retry policy.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  WebinarJobContext,
  WebinarJobData,
  WebinarJobHandler,
  WebinarJobName,
} from '../jobs/webinar-job-scheduler.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarRecordingService, type RecordingFinalizeResult, type RecordingStartResult } from './recording.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarMailer } from './webinar-mailer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarsRepository } from './webinars.repository.js';

export interface WebinarReminderResult {
  registrationId: string;
  sent: boolean;
  skipped?: 'not_found' | 'canceled' | 'status' | 'started';
}

@Injectable()
export class WebinarJobsService implements WebinarJobHandler {
  private readonly logger = new Logger(WebinarJobsService.name);

  constructor(
    private readonly repo: WebinarsRepository,
    private readonly mail: WebinarMailer,
    private readonly recording: WebinarRecordingService,
  ) {}

  async handle<N extends WebinarJobName>(name: N, data: WebinarJobData[N], context?: WebinarJobContext): Promise<unknown> {
    switch (name) {
      case 'webinar.remind':
        return this.remind(data as WebinarJobData['webinar.remind']);
      case 'webinar.recording.start':
        return this.recordingStart(data as WebinarJobData['webinar.recording.start'], context);
      case 'webinar.recording.finalize':
        return this.recordingFinalize(data as WebinarJobData['webinar.recording.finalize'], context);
      default:
        throw new Error(`Unknown webinar job: ${String(name)}`);
    }
  }

  async remind(data: WebinarJobData['webinar.remind'], now: Date = new Date()): Promise<WebinarReminderResult> {
    const { registrationId } = data;
    const registration = await this.repo.findRegistrationById(registrationId);
    if (!registration) return { registrationId, sent: false, skipped: 'not_found' };
    if (registration.canceledAt) return { registrationId, sent: false, skipped: 'canceled' };
    const webinar = await this.repo.findById(registration.webinarId);
    if (!webinar) return { registrationId, sent: false, skipped: 'not_found' };
    if (webinar.status !== 'published' && webinar.status !== 'live') return { registrationId, sent: false, skipped: 'status' };
    if (webinar.startsAt.getTime() <= now.getTime()) return { registrationId, sent: false, skipped: 'started' };

    const sent = await this.mail.reminder(registration.userId, registration.id, webinar);
    this.logger.log({ webinarId: webinar.id, registrationId, operation: 'remind', offsetMinutes: data.offsetMinutes }, 'Webinar reminder');
    return { registrationId, sent };
  }

  /** The media capture pipeline, once the host's meeting has a presenter (T-CW-2.5). */
  recordingStart(data: WebinarJobData['webinar.recording.start'], context?: WebinarJobContext): Promise<RecordingStartResult> {
    return this.recording.start(data, context);
  }

  /** Capture stop, concatenation, READY and the CMS handoff (T-CW-2.5). */
  recordingFinalize(data: WebinarJobData['webinar.recording.finalize'], context?: WebinarJobContext): Promise<RecordingFinalizeResult> {
    return this.recording.finalize(data, context);
  }
}
