/**
 * WebinarsModule bootstrap (T-CW-2.5, DEF-5): with the fake video provider
 * the meetings live in the API process's memory, so the webinar jobs (the
 * recording start and finalize above all) must run there. The API process
 * starts the webinar job consumer; the worker, which boots the same
 * modules without an HTTP server, leaves the queue to the API.
 */
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import type { WebinarJobSchedulerService } from '../jobs/webinar-job-scheduler.service.js';
import type { WebinarJobsService } from './webinar-jobs.service.js';
import type { WebinarsRepository } from './webinars.repository.js';
import { WebinarsModule } from './webinars.module.js';

function setup(options: { consumesInApi: boolean; http: boolean }) {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const scheduler = {
    consumesInApi: vi.fn(() => options.consumesInApi),
    start: vi.fn(async () => true),
    leaveToApi: vi.fn(),
  };
  const jobs = { handle: vi.fn() } as unknown as WebinarJobsService;
  const adapterHost = { httpAdapter: options.http ? {} : undefined } as unknown as HttpAdapterHost;
  const module = new WebinarsModule(
    {} as WebinarsRepository,
    scheduler as unknown as WebinarJobSchedulerService,
    jobs,
    adapterHost,
  );
  return { module, scheduler, jobs };
}

describe('WebinarsModule.onApplicationBootstrap', () => {
  it('starts the webinar job consumer in the API process with the fake provider', async () => {
    const { module, scheduler, jobs } = setup({ consumesInApi: true, http: true });
    await module.onApplicationBootstrap();
    expect(scheduler.start).toHaveBeenCalledWith(jobs);
    expect(scheduler.leaveToApi).not.toHaveBeenCalled();
  });

  it('keeps the worker from consuming the same queue with the fake provider', async () => {
    const { module, scheduler } = setup({ consumesInApi: true, http: false });
    await module.onApplicationBootstrap();
    expect(scheduler.leaveToApi).toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('does nothing with the real provider: the worker consumes, the API only produces', async () => {
    for (const http of [true, false]) {
      const { module, scheduler } = setup({ consumesInApi: false, http });
      await module.onApplicationBootstrap();
      expect(scheduler.start).not.toHaveBeenCalled();
      expect(scheduler.leaveToApi).not.toHaveBeenCalled();
    }
  });
});
