import { Controller, Get } from '@nestjs/common';
import { Roles, OrgParam } from '../auth/roles.decorator.js';

@Controller('orgs/:orgId/programme')
@OrgParam('orgId')
export class ProgrammeController {
  @Get()
  @Roles('hr_admin', 'operations', 'admin')
  getProgramme() {
    return {
      sample: true,
      note: 'Placeholder. Programme figures come from contracts and a privacy risk assessment.',
      eligibleEmployees: null,
    };
  }
}
