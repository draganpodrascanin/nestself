import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { AppointmentRecord } from './appointments.repository.js';
import { AppointmentCancelHooks } from './appointment-cancel-hooks.js';

const appointment = { id: 'appt_1', orgId: 'org_1' } as AppointmentRecord;

describe('AppointmentCancelHooks', () => {
  it('runs every registered hook with the appointment and the canceller, and survives a failing one', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const hooks = new AppointmentCancelHooks();
    const failing = vi.fn(async () => {
      throw new Error('provider down');
    });
    const ending = vi.fn(async () => true);
    hooks.register('first', failing);
    const remove = hooks.register('calls', ending);

    await hooks.run(appointment, 'user_jovan');
    expect(failing).toHaveBeenCalledWith(appointment, 'user_jovan');
    expect(ending).toHaveBeenCalledWith(appointment, 'user_jovan');

    remove();
    await hooks.run(appointment, 'user_jovan');
    expect(ending).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
