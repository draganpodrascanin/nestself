/**
 * UsersModule — operations endpoints on platform users (T-1.18).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
