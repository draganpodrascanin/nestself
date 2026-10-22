/**
 * Global audit module. Provides `AuditWriter` to the entire application.
 *
 * @see D-21, T-0.4
 */
import { Global, Module } from '@nestjs/common';
import { AuditWriter } from './audit-writer.js';

@Global()
@Module({
  providers: [AuditWriter],
  exports: [AuditWriter],
})
export class AuditModule {}
