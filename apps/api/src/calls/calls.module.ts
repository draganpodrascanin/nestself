/**
 * CallsModule: consultation call sessions (T-CW-1.1, NS-CALLS-01). Binds the
 * call session lookup to `callSessionResource`, which runs inside the global
 * AuthorizationGuard, outside dependency injection.
 */
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsRepository } from '../appointments/appointments.repository.js';
import { VideoModule } from '../video/video.module.js';
import { WsModule } from '../ws/ws.module.js';
import { bindCallSessionLookup } from './call-session.resolver.js';
import { CallsController } from './calls.controller.js';
import { CallsRepository } from './calls.repository.js';
import { CallsService } from './calls.service.js';

@Module({
  imports: [AuthModule, AppointmentsModule, VideoModule, WsModule],
  controllers: [CallsController],
  providers: [CallsRepository, CallsService],
  exports: [CallsRepository, CallsService],
})
export class CallsModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly repo: CallsRepository,
    private readonly appointments: AppointmentsRepository,
  ) {}

  onModuleInit(): void {
    bindCallSessionLookup({
      findSessionById: (id) => this.repo.findSessionById(id),
      findAppointmentById: (id) => this.appointments.findById(id),
    });
  }

  onModuleDestroy(): void {
    bindCallSessionLookup(null);
  }
}
