import { Module } from '@nestjs/common';
import { ProgrammeController } from './programme.controller.js';

@Module({
  controllers: [ProgrammeController],
})
export class ProgrammeModule {}
