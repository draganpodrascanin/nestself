/**
 * AvailabilityModule — exports the availability services for composition
 * by library read paths, the CMS, and media delivery.
 *
 * No controllers in this task; endpoints come in later tasks.
 */
import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service.js';
import { AvailabilityContextLoader } from './availability-context-loader.js';
import { AvailabilityVersionService } from './availability-version.service.js';

@Module({
  providers: [
    AvailabilityService,
    AvailabilityContextLoader,
    AvailabilityVersionService,
  ],
  exports: [
    AvailabilityService,
    AvailabilityContextLoader,
    AvailabilityVersionService,
  ],
})
export class AvailabilityModule {}
