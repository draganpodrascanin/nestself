import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  providers: [AuthGuard, RolesGuard],
  exports: [AuthGuard, RolesGuard],
})
export class AuthModule {}
