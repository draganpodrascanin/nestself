import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { appointmentResource, bindAppointmentLookup } from './appointment.resolver.js';
import type { AppointmentRecord } from './appointments.repository.js';

const principal = { userId: 'user_jovan' } as Principal;

const record: AppointmentRecord = {
  id: 'appt_1',
  orgId: 'org_sample',
  expertUserId: 'user_milica',
  employeeUserId: 'user_jovan',
  startsAt: new Date('2026-11-10T15:00:00Z'),
  endsAt: new Date('2026-11-10T15:50:00Z'),
  status: 'confirmed',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: null,
  createdAt: new Date('2026-10-24T10:00:00Z'),
  updatedAt: new Date('2026-10-24T10:00:00Z'),
};

const lookup = { findById: (id: string) => Promise.resolve(id === record.id ? record : null) };

async function notFoundError(promise: Promise<unknown>): Promise<ApiHttpException> {
  const error = await Promise.resolve(promise).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiHttpException);
  const apiError = error as ApiHttpException;
  expect(apiError.getStatus()).toBe(404);
  expect(apiError.code).toBe('not_found');
  return apiError;
}

describe('appointmentResource', () => {
  afterEach(() => bindAppointmentLookup(null));

  it('derives the organization, owner, id and category from the loaded row', async () => {
    bindAppointmentLookup(lookup);
    const resource = await appointmentResource({ params: { id: 'appt_1' } }, principal);
    expect(resource).toEqual({
      type: 'appointment',
      id: 'appt_1',
      orgId: 'org_sample',
      ownerId: 'user_jovan',
      category: 'psychological',
    });
  });

  it('answers 404 for a missing row or a route without :id', async () => {
    bindAppointmentLookup(lookup);
    await notFoundError(Promise.resolve(appointmentResource({ params: { id: 'appt_missing' } }, principal)));
    await notFoundError(Promise.resolve().then(() => appointmentResource({ params: {} }, principal)));
  });

  it('fails closed when the module has not bound the lookup', async () => {
    const error = await Promise.resolve()
      .then(() => appointmentResource({ params: { id: 'appt_1' } }, principal))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiHttpException);
  });
});
