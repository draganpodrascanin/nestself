/**
 * Relational-query metadata for `db.query.*` (not foreign keys: those live on
 * the tables). Only the relations the API reads are declared.
 */
import { relations } from 'drizzle-orm';
import { externalIdentities, users } from './identity.js';
import { memberships, organizations, orgUnitClosure, orgUnits } from './organization.js';
import { assignments, grants, permissionTemplates } from './authorization.js';
import { invitations, ssoConnections, ssoDomains } from './invitations.js';
import { expertCredentials, experts } from './content.js';

export const usersRelations = relations(users, ({ many, one }) => ({
  externalIdentities: many(externalIdentities),
  memberships: many(memberships, { relationName: 'membershipUser' }),
  grants: many(grants, { relationName: 'grantSubject' }),
  assignments: many(assignments, { relationName: 'assignmentUser' }),
  expert: one(experts, { fields: [users.id], references: [experts.userId] }),
}));

export const externalIdentitiesRelations = relations(externalIdentities, ({ one }) => ({
  user: one(users, { fields: [externalIdentities.userId], references: [users.id] }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  orgUnits: many(orgUnits),
  memberships: many(memberships),
  invitations: many(invitations),
  ssoConnections: many(ssoConnections),
}));

export const orgUnitsRelations = relations(orgUnits, ({ one, many }) => ({
  org: one(organizations, { fields: [orgUnits.orgId], references: [organizations.id] }),
  parent: one(orgUnits, {
    fields: [orgUnits.parentId],
    references: [orgUnits.id],
    relationName: 'orgUnitTree',
  }),
  children: many(orgUnits, { relationName: 'orgUnitTree' }),
  closureAncestors: many(orgUnitClosure, { relationName: 'closureDescendant' }),
}));

export const orgUnitClosureRelations = relations(orgUnitClosure, ({ one }) => ({
  ancestor: one(orgUnits, {
    fields: [orgUnitClosure.ancestorId],
    references: [orgUnits.id],
    relationName: 'closureAncestor',
  }),
  descendant: one(orgUnits, {
    fields: [orgUnitClosure.descendantId],
    references: [orgUnits.id],
    relationName: 'closureDescendant',
  }),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
    relationName: 'membershipUser',
  }),
  org: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
  orgUnit: one(orgUnits, { fields: [memberships.orgUnitId], references: [orgUnits.id] }),
}));

export const grantsRelations = relations(grants, ({ one }) => ({
  subject: one(users, {
    fields: [grants.subjectUserId],
    references: [users.id],
    relationName: 'grantSubject',
  }),
  template: one(permissionTemplates, {
    fields: [grants.templateKey],
    references: [permissionTemplates.key],
  }),
  scopeOrg: one(organizations, { fields: [grants.scopeOrgId], references: [organizations.id] }),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  user: one(users, {
    fields: [assignments.userId],
    references: [users.id],
    relationName: 'assignmentUser',
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  org: one(organizations, { fields: [invitations.orgId], references: [organizations.id] }),
  orgUnit: one(orgUnits, { fields: [invitations.orgUnitId], references: [orgUnits.id] }),
}));

export const ssoConnectionsRelations = relations(ssoConnections, ({ one, many }) => ({
  org: one(organizations, { fields: [ssoConnections.orgId], references: [organizations.id] }),
  domains: many(ssoDomains),
}));

export const ssoDomainsRelations = relations(ssoDomains, ({ one }) => ({
  connection: one(ssoConnections, {
    fields: [ssoDomains.connectionId],
    references: [ssoConnections.id],
  }),
}));

export const expertsRelations = relations(experts, ({ one, many }) => ({
  user: one(users, { fields: [experts.userId], references: [users.id] }),
  credentials: many(expertCredentials),
}));

export const expertCredentialsRelations = relations(expertCredentials, ({ one }) => ({
  expert: one(experts, { fields: [expertCredentials.expertId], references: [experts.id] }),
}));
