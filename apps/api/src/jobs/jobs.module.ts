/**
 * JobsModule — BullMQ job authorization wrapper (T-1.17).
 *
 * Queues and workers are registered by the features that own them; every
 * processor is wrapped with `JobAuthorization.wrap()` so that the job
 * re-authorizes against the principal's current state (AUTHZ-R-53).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JobAuthorization } from './job-authorization.js';

@Module({
  imports: [AuthModule],
  providers: [JobAuthorization],
  exports: [JobAuthorization],
})
export class JobsModule {}
