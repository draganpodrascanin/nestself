/**
 * WebinarJobsService: what the `nestself-webinars` jobs do (T-CW-2.1); the
 * worker passes it to `WebinarJobSchedulerService.start()`.
 *
 * - `webinar.remind` (WBN-05, D-CW-26): re-reads the registration and the
 *   occurrence (CW-R-37) and sends the `webinar.reminder` email only while
 *   the registration is active, the occurrence `published` or `live` and
 *   not yet started; otherwise it exits without action.
 * - `webinar.recording.start` (CW-R-107): enqueued by `POST
 *   /webinars/:id/start`. For now it logs and leaves `recording_status` at
 *   `SCHEDULED`; T-CW-2.5 replaces it with the media capture pipeline.
 * - `webinar.recording.finalize`: a placeholder for T-CW-2.5.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { WebinarJobData, WebinarJobHandler, WebinarJobName } from '../jobs/webinar-job-scheduler.service.js';
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
  ) {}

  async handle<N extends WebinarJobName>(name: N, data: WebinarJobData[N]): Promise<unknown> {
    switch (name) {
      case 'webinar.remind':
        return this.remind(data as WebinarJobData['webinar.remind']);
      case 'webinar.recording.start':
        return this.recordingStart(data as WebinarJobData['webinar.recording.start']);
      case 'webinar.recording.finalize':
        return this.recordingFinalize(data as WebinarJobData['webinar.recording.finalize']);
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

  /** T-CW-2.5 starts the media capture pipeline here; until then the status stays SCHEDULED. */
  async recordingStart(data: WebinarJobData['webinar.recording.start']): Promise<{ webinarId: string; started: false }> {
    this.logger.log(
      { webinarId: data.webinarId, sessionId: data.sessionId, operation: 'recording.start' },
      'Webinar recording start requested; the pipeline arrives with T-CW-2.5',
    );
    return { webinarId: data.webinarId, started: false };
  }

  /** T-CW-2.5 concatenates the segments and hands the recording off here. */
  async recordingFinalize(data: WebinarJobData['webinar.recording.finalize']): Promise<{ webinarId: string; finalized: false }> {
    this.logger.log(
      { webinarId: data.webinarId, sessionId: data.sessionId, operation: 'recording.finalize' },
      'Webinar recording finalize requested; the pipeline arrives with T-CW-2.5',
    );
    return { webinarId: data.webinarId, finalized: false };
  }
}
