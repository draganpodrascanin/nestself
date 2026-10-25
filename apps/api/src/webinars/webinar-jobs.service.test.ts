/**
 * WebinarJobsService (T-CW-2.1, WBN-05, CW-R-37): a reminder re-reads the
 * registration and the occurrence and sends only for an active registration
 * of an occurrence that is still to start; the recording jobs go to the
 * recording pipeline with their attempt context (T-CW-2.5).
 */
import { describe, expect, it, vi } from 'vitest';
import type { WebinarRecordingService } from './recording.service.js';
import type { WebinarMailer } from './webinar-mailer.js';
import { WebinarJobsService } from './webinar-jobs.service.js';
import type { WebinarRecord, WebinarRegistrationRecord, WebinarsRepository } from './webinars.repository.js';

const NOW = new Date('2026-11-24T16:00:00.000Z');
const webinar = { id: 'w1', status: 'published', startsAt: new Date('2026-11-25T16:00:00.000Z') } as WebinarRecord;
const registration = { id: 'reg_1', webinarId: 'w1', userId: 'user_jovan', canceledAt: null } as WebinarRegistrationRecord;

function setup(found: { registration?: Partial<WebinarRegistrationRecord> | null; webinar?: Partial<WebinarRecord> | null }) {
  const repo = {
    findRegistrationById: async () => (found.registration === null ? null : { ...registration, ...found.registration }),
    findById: async () => (found.webinar === null ? null : { ...webinar, ...found.webinar }),
  } as unknown as WebinarsRepository;
  const reminder = vi.fn(async () => true);
  const recording = {
    start: vi.fn(async () => ({ webinarId: 'w1', started: true })),
    finalize: vi.fn(async () => ({ webinarId: 'w1', finalized: true })),
  };
  const service = new WebinarJobsService(repo, { reminder } as unknown as WebinarMailer, recording as unknown as WebinarRecordingService);
  return { service, reminder, recording };
}

const job = { webinarId: 'w1', registrationId: 'reg_1', offsetMinutes: 1440 };

describe('webinar.remind', () => {
  it('sends the reminder for an active registration of a published occurrence still to start', async () => {
    const { service, reminder } = setup({});
    expect(await service.remind(job, NOW)).toEqual({ registrationId: 'reg_1', sent: true });
    expect(reminder).toHaveBeenCalledWith('user_jovan', 'reg_1', expect.objectContaining({ id: 'w1' }));
  });

  it('exits without action after unregistration, cancellation or the start (WBN-05 criterion 3)', async () => {
    const cases = [
      [{ registration: null }, 'not_found'],
      [{ registration: { canceledAt: NOW } }, 'canceled'],
      [{ webinar: { status: 'canceled' } }, 'status'],
      [{ webinar: { startsAt: NOW } }, 'started'],
    ] as const;
    for (const [found, skipped] of cases) {
      const { service, reminder } = setup(found as Parameters<typeof setup>[0]);
      expect(await service.remind(job, NOW)).toEqual({ registrationId: 'reg_1', sent: false, skipped });
      expect(reminder).not.toHaveBeenCalled();
    }
  });
});

describe('recording jobs (T-CW-2.5)', () => {
  it('hand the job and its attempt context to the recording pipeline', async () => {
    const { service, recording } = setup({});
    const context = { attempt: 2, maxAttempts: 3, enqueuedAt: NOW };
    expect(await service.handle('webinar.recording.start', { webinarId: 'w1', sessionId: null }, context)).toEqual({
      webinarId: 'w1',
      started: true,
    });
    expect(recording.start).toHaveBeenCalledWith({ webinarId: 'w1', sessionId: null }, context);
    expect(await service.handle('webinar.recording.finalize', { webinarId: 'w1', sessionId: 's1' }, context)).toEqual({
      webinarId: 'w1',
      finalized: true,
    });
    expect(recording.finalize).toHaveBeenCalledWith({ webinarId: 'w1', sessionId: 's1' }, context);
  });
});
