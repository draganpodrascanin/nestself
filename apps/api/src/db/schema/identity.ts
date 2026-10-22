/**
 * Identity tables: users and their identity-provider links [D-02, D-04].
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { platformRole } from './enums.js';
import { createdAt, idColumn, ts, updatedAt } from './_shared.js';

/**
 * A person with an identity on the platform. One row per natural person,
 * independent of employers [D-02, D-04, SYS-01].
 */
export const users = pgTable(
  'users',
  {
    id: idColumn(),
    /** Unique, stored lowercase; enforced by `users_email_lowercase_check`. */
    email: text().notNull(),
    displayName: text().notNull(),
    /** Default locale synced to Cognito custom:locale [D-02]. */
    locale: text().notNull().default('sr-Latn'),
    /** Set when the email is verified through invitation acceptance or identity binding. */
    emailVerifiedAt: ts(),
    /** Non-null suspends all sessions within the cache window [D-18]. */
    suspendedAt: ts(),
    /** Soft deletion; row retained per retention policy [SYS-10]. */
    deactivatedAt: ts(),
    /** Updated on each successful sign-in. */
    lastSignInAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** @deprecated Removed in phase 2; use templates and grants [D-36]. */
    platformRole: platformRole(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_lowercase_check', sql`${t.email} = lower(${t.email})`),
  ],
);

/** Link from a user to an identity-provider subject [D-02, D-04]. */
export const externalIdentities = pgTable(
  'external_identities',
  {
    id: idColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** "cognito" for pool-native or "cognito:<providerName>" for federated [D-04]. */
    provider: text().notNull(),
    /** Cognito sub claim; globally unique per provider. */
    subject: text().notNull(),
    /** Cognito Username field (may differ from sub for federated users). */
    cognitoUsername: text().notNull(),
    /** Email from the identity provider at the most recent sign-in. */
    email: text().notNull(),
    /** Whether the IdP asserted email ownership [D-04]. */
    emailVerified: boolean().notNull().default(false),
    /** Updated on each sign-in through this identity. */
    lastSeenAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('external_identities_provider_subject_key').on(t.provider, t.subject),
    index('external_identities_user_id_idx').on(t.userId),
  ],
);
