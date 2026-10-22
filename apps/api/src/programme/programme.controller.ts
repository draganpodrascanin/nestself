import { Controller, Get } from '@nestjs/common';
import { ACTIONS } from '@nestself/contracts';
import type { Resource } from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';

@Controller('orgs/:orgId/programme')
export class ProgrammeController {
  @Get()
  @Authorize(ACTIONS['program.overview'], (req: Record<string, unknown>) => {
    const params = req['params'] as { orgId: string };
    return {
      type: 'program',
      orgId: params.orgId,
    } satisfies Resource;
  })
  getProgramme() {
    return {
      sample: true,
      note: 'Placeholder. Programme figures come from contracts and a privacy risk assessment.',
      eligibleEmployees: null,
    };
  }
}
