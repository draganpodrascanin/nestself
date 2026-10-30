/**
 * AppointmentCancelHooks: what other modules do when an appointment is
 * canceled, after the cancel committed (CALL-27). `CallsModule` registers the
 * end of a live call session here: the calls module depends on this one, so
 * the appointments service cannot call it directly. Every hook is best
 * effort: the cancel has succeeded, so a failing hook is logged with ids only
 * and never thrown.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AppointmentRecord } from './appointments.repository.js';

export type AppointmentCanceledHook = (appointment: AppointmentRecord, canceledByUserId: string) => Promise<unknown>;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class AppointmentCancelHooks {
  private readonly logger = new Logger(AppointmentCancelHooks.name);
  private readonly hooks = new Map<string, AppointmentCanceledHook>();

  /** Registers `hook` under `name`; returns the call that removes it. */
  register(name: string, hook: AppointmentCanceledHook): () => void {
    this.hooks.set(name, hook);
    return () => {
      if (this.hooks.get(name) === hook) this.hooks.delete(name);
    };
  }

  async run(appointment: AppointmentRecord, canceledByUserId: string): Promise<void> {
    for (const [name, hook] of this.hooks) {
      try {
        await hook(appointment, canceledByUserId);
      } catch (error) {
        this.logger.error(
          { appointmentId: appointment.id, operation: `cancelHook:${name}`, error: errorName(error) },
          'Cancel hook failed',
        );
      }
    }
  }
}
