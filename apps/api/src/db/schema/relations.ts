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
import { categories, categoryLabels } from './taxonomy.js';
import {
  contentPublicationAudiences,
  contentPublications,
  contentResources,
  contentRevisionMedia,
  contentRevisions,
  contentVariants,
} from './cms.js';
import { mediaAssets, mediaRenditions } from './media.js';
import { outboxDeliveries, outboxEvents } from './notifications.js';

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

// ─── CMS relations ──────────────────────────────────────────────────────

export const categoriesRelations = relations(categories, ({ many }) => ({
  labels: many(categoryLabels),
  resources: many(contentResources),
}));

export const categoryLabelsRelations = relations(categoryLabels, ({ one }) => ({
  category: one(categories, { fields: [categoryLabels.categoryId], references: [categories.id] }),
}));

export const contentResourcesRelations = relations(contentResources, ({ one, many }) => ({
  primaryCategory: one(categories, {
    fields: [contentResources.primaryCategoryId],
    references: [categories.id],
  }),
  owner: one(users, {
    fields: [contentResources.ownerUserId],
    references: [users.id],
    relationName: 'resourceOwner',
  }),
  variants: many(contentVariants),
}));

export const contentVariantsRelations = relations(contentVariants, ({ one, many }) => ({
  resource: one(contentResources, {
    fields: [contentVariants.contentResourceId],
    references: [contentResources.id],
  }),
  revisions: many(contentRevisions),
  publications: many(contentPublications),
}));

export const contentRevisionsRelations = relations(contentRevisions, ({ one, many }) => ({
  variant: one(contentVariants, {
    fields: [contentRevisions.contentVariantId],
    references: [contentVariants.id],
  }),
  media: many(contentRevisionMedia),
}));

export const contentRevisionMediaRelations = relations(contentRevisionMedia, ({ one }) => ({
  revision: one(contentRevisions, {
    fields: [contentRevisionMedia.contentRevisionId],
    references: [contentRevisions.id],
  }),
  asset: one(mediaAssets, {
    fields: [contentRevisionMedia.mediaAssetId],
    references: [mediaAssets.id],
  }),
}));

export const contentPublicationsRelations = relations(contentPublications, ({ one, many }) => ({
  variant: one(contentVariants, {
    fields: [contentPublications.contentVariantId],
    references: [contentVariants.id],
  }),
  revision: one(contentRevisions, {
    fields: [contentPublications.contentRevisionId],
    references: [contentRevisions.id],
  }),
  audiences: many(contentPublicationAudiences),
}));

export const contentPublicationAudiencesRelations = relations(
  contentPublicationAudiences,
  ({ one }) => ({
    publication: one(contentPublications, {
      fields: [contentPublicationAudiences.publicationId],
      references: [contentPublications.id],
    }),
  }),
);

export const mediaAssetsRelations = relations(mediaAssets, ({ many }) => ({
  renditions: many(mediaRenditions),
}));

export const mediaRenditionsRelations = relations(mediaRenditions, ({ one }) => ({
  asset: one(mediaAssets, {
    fields: [mediaRenditions.mediaAssetId],
    references: [mediaAssets.id],
  }),
}));

export const outboxEventsRelations = relations(outboxEvents, ({ many }) => ({
  deliveries: many(outboxDeliveries),
}));

export const outboxDeliveriesRelations = relations(outboxDeliveries, ({ one }) => ({
  event: one(outboxEvents, {
    fields: [outboxDeliveries.outboxEventId],
    references: [outboxEvents.id],
  }),
}));
