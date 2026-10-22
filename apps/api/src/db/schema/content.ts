/**
 * Experts, content, community (channels, posts, polls), leads and event
 * requests. Retained from the scaffold schema; channels and event requests are
 * tenant-scoped (RLS).
 */
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  channelScope,
  contentKind,
  eventRequestStatus,
  expertCredentialStatus,
  leadKind,
  supportArea,
} from './enums.js';
import { users } from './identity.js';
import { legacyTeams, organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, textArray, ts, updatedAt } from './_shared.js';

/** An independent professional delivering services. */
export const experts = pgTable(
  'experts',
  {
    id: idColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** @deprecated Replaced by expert_credentials.service_category. */
    area: supportArea().notNull(),
    languages: textArray(),
    bio: text(),
  },
  (t) => [uniqueIndex('experts_user_id_key').on(t.userId)],
);

/** Expert credential verification record [LEAD-01]. */
export const expertCredentials = pgTable(
  'expert_credentials',
  {
    id: idColumn(),
    expertId: text()
      .notNull()
      .references(() => experts.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Aligns with support_area values (psychological, legal, financial). */
    serviceCategory: text().notNull(),
    status: expertCredentialStatus().notNull().default('PENDING_REVIEW'),
    reviewedByUserId: text().references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    effectiveFrom: ts(),
    expiresAt: ts(),
    /** Internal review notes. */
    notes: text(),
  },
  (t) => [index('expert_credentials_expert_id_status_idx').on(t.expertId, t.status)],
);

export const contentItems = pgTable('content_items', {
  id: idColumn(),
  title: text().notNull(),
  summary: text().notNull(),
  body: text().notNull(),
  kind: contentKind().notNull(),
  area: supportArea().notNull(),
  locale: text().notNull().default('en'),
  expertId: text().references(() => experts.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const channels = pgTable(
  'channels',
  {
    id: idColumn(),
    name: text().notNull(),
    scope: channelScope().notNull(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    teamId: text().references(() => legacyTeams.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  },
  (t) => [
    pgPolicy('channels_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

export const posts = pgTable('posts', {
  id: idColumn(),
  body: text().notNull(),
  channelId: text()
    .notNull()
    .references(() => channels.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  authorId: text()
    .notNull()
    .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  createdAt: createdAt(),
});

export const polls = pgTable('polls', {
  id: idColumn(),
  question: text().notNull(),
  teamId: text()
    .notNull()
    .references(() => legacyTeams.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  closesAt: ts(),
  createdAt: createdAt(),
});

export const pollOptions = pgTable('poll_options', {
  id: idColumn(),
  label: text().notNull(),
  pollId: text()
    .notNull()
    .references(() => polls.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
});

export const pollVotes = pgTable(
  'poll_votes',
  {
    id: idColumn(),
    optionId: text()
      .notNull()
      .references(() => pollOptions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
  },
  (t) => [uniqueIndex('poll_votes_option_id_user_id_key').on(t.optionId, t.userId)],
);

/** Marketing lead captured by the public site forms. */
export const leads = pgTable(
  'leads',
  {
    id: idColumn(),
    kind: leadKind().notNull(),
    email: text().notNull(),
    locale: text().notNull(),
    source: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('leads_kind_created_at_idx').on(t.kind, t.createdAt)],
);

export const eventRequests = pgTable(
  'event_requests',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    participants: integer().notNull(),
    location: text().notNull(),
    dateRange: text().notNull(),
    budget: text().notNull(),
    purpose: text().notNull(),
    options: textArray(),
    status: eventRequestStatus().notNull().default('REQUESTED'),
    createdAt: createdAt(),
  },
  (t) => [
    pgPolicy('event_requests_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
