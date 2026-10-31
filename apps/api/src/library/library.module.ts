/**
 * LibraryModule — employee library controllers and services (T-C1.11).
 *
 * Imports AvailabilityModule for the availability formula.
 */
import { Module } from '@nestjs/common';
import { AvailabilityModule } from './availability/availability.module.js';
import { LibraryService } from './library.service.js';
import { LibraryController } from './library.controller.js';
import { SavedController } from './saved.controller.js';

@Module({
  imports: [AvailabilityModule],
  controllers: [LibraryController, SavedController],
  providers: [LibraryService],
  exports: [LibraryService],
})
export class LibraryModule {}
