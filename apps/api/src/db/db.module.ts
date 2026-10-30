import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service.js';
import { IdentityRepository } from './repositories/identity.repository.js';
import { AuthorizationRepository } from './repositories/authorization.repository.js';
import { AuditRepository } from './repositories/audit.repository.js';
import { LeadsRepository } from './repositories/leads.repository.js';
import { InvitationsRepository } from './repositories/invitations.repository.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';
import { OrgUnitsRepository } from './repositories/org-units.repository.js';
import { ApprovalAuthoritiesRepository } from './repositories/approval-authorities.repository.js';
import { ProfessionalRepository } from './repositories/professional.repository.js';
import { OrganizationsRepository } from './repositories/organizations.repository.js';
import { SsoRepository } from './repositories/sso.repository.js';

/**
 * Global database module: the Drizzle handle plus the repositories every
 * feature module reads through. Tests override `DbService` with a stub and
 * the repositories they exercise with mocks.
 */
@Global()
@Module({
  providers: [
    DbService,
    IdentityRepository,
    AuthorizationRepository,
    AuditRepository,
    LeadsRepository,
    InvitationsRepository,
    MembershipsRepository,
    OrgUnitsRepository,
    ApprovalAuthoritiesRepository,
    ProfessionalRepository,
    OrganizationsRepository,
    SsoRepository,
  ],
  exports: [
    DbService,
    IdentityRepository,
    AuthorizationRepository,
    AuditRepository,
    LeadsRepository,
    InvitationsRepository,
    MembershipsRepository,
    OrgUnitsRepository,
    ApprovalAuthoritiesRepository,
    ProfessionalRepository,
    OrganizationsRepository,
    SsoRepository,
  ],
})
export class DbModule {}
