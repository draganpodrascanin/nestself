-- Migration: 001_identity_org_auth_audit
-- Phase 0: identity, org tree, authorization and audit schema.
--
-- Key changes to existing tables:
-- 1. "teams" table renamed to "legacy_teams" so a VIEW can take the name.
-- 2. User: new columns (emailVerifiedAt, suspendedAt, deactivatedAt, lastSignInAt), locale default -> sr-Latn.
-- 3. Organization: new columns (country, timezone, contractStart, contractEnd, ownerUserId, etc.).
-- 4. Membership: new columns (orgUnitId, costCenterUnitId, lineManagerUserId, status, startDate, endDate, endedReason, updatedAt).
--    Unique constraint changed from (userId, orgId) to (userId, orgId, startDate).
--    Existing rows backfilled with status='ACTIVE', startDate=now().

-- CreateEnum
CREATE TYPE "OrgUnitKind" AS ENUM ('COMPANY', 'DEPARTMENT', 'TEAM');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "SsoProtocol" AS ENUM ('SAML', 'OIDC');

-- CreateEnum
CREATE TYPE "SsoConnectionStatus" AS ENUM ('DRAFT', 'TESTING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('CASE', 'QUEUE', 'CLIENT', 'PRACTICE_GROUP', 'COLLECTION', 'SUPPORT_CASE', 'SUPERVISION', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('SECURITY', 'AUTHORIZATION', 'FINANCIAL', 'CONTENT_ACCESS', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('ALLOWED', 'DENIED', 'NONE');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('USER', 'SYSTEM', 'JOB');

-- CreateEnum
CREATE TYPE "EmergencyScopeKind" AS ENUM ('CASE', 'USER_RECORDS');

-- CreateEnum
CREATE TYPE "ExpertCredentialStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'EXPIRED', 'REVOKED');

-- ═══════════════════════════════════════════════════════════════════
-- Rename legacy teams table
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "teams" RENAME TO "legacy_teams";

-- ═══════════════════════════════════════════════════════════════════
-- Extend User
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "suspended_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deactivated_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" TIMESTAMP(3);
ALTER TABLE "users" ALTER COLUMN "locale" SET DEFAULT 'sr-Latn';

-- ═══════════════════════════════════════════════════════════════════
-- Extend Organization
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "organizations" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'RS';
ALTER TABLE "organizations" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Belgrade';
ALTER TABLE "organizations" ADD COLUMN "contract_start" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "contract_end" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "owner_user_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN "self_approval_allowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "financial_step_up_threshold_minor" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "cohort_threshold" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- FK: Organization.ownerUserId -> User
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- Extend Membership (add new columns, backfill, swap unique)
-- ═══════════════════════════════════════════════════════════════════

-- Add nullable columns first
ALTER TABLE "memberships" ADD COLUMN "org_unit_id" TEXT;
ALTER TABLE "memberships" ADD COLUMN "cost_center_unit_id" TEXT;
ALTER TABLE "memberships" ADD COLUMN "line_manager_user_id" TEXT;
ALTER TABLE "memberships" ADD COLUMN "end_date" TIMESTAMP(3);
ALTER TABLE "memberships" ADD COLUMN "ended_reason" TEXT;
ALTER TABLE "memberships" ADD COLUMN "created_at" TIMESTAMP(3);
ALTER TABLE "memberships" ADD COLUMN "updated_at" TIMESTAMP(3);

-- Add status as nullable, backfill, then set NOT NULL
ALTER TABLE "memberships" ADD COLUMN "status" "MembershipStatus";

-- Add start_date as nullable, backfill, then set NOT NULL
ALTER TABLE "memberships" ADD COLUMN "start_date" TIMESTAMP(3);

-- Backfill existing rows
UPDATE "memberships" SET "status" = 'ACTIVE' WHERE "status" IS NULL;
UPDATE "memberships" SET "start_date" = NOW() WHERE "start_date" IS NULL;
UPDATE "memberships" SET "created_at" = NOW() WHERE "created_at" IS NULL;
UPDATE "memberships" SET "updated_at" = NOW() WHERE "updated_at" IS NULL;

-- Now set NOT NULL and defaults
ALTER TABLE "memberships" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "memberships" ALTER COLUMN "status" SET DEFAULT 'INVITED';
ALTER TABLE "memberships" ALTER COLUMN "start_date" SET NOT NULL;
ALTER TABLE "memberships" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "memberships" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "memberships" ALTER COLUMN "updated_at" SET NOT NULL;

-- Drop old unique constraint (Prisma creates it as a unique index) and add new one.
DROP INDEX IF EXISTS "memberships_user_id_org_id_key";
CREATE UNIQUE INDEX "memberships_user_id_org_id_start_date_key" ON "memberships"("user_id", "org_id", "start_date");

-- Membership indexes
CREATE INDEX "memberships_org_id_status_idx" ON "memberships"("org_id", "status");

-- Membership FKs for new columns (org_unit_id, cost_center_unit_id, line_manager_user_id)
-- These will reference org_units table created below

-- ═══════════════════════════════════════════════════════════════════
-- Create new tables
-- ═══════════════════════════════════════════════════════════════════

-- ExternalIdentity
CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "cognito_username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_identities_provider_subject_key" ON "external_identities"("provider", "subject");
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");

ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrgUnit
CREATE TABLE "org_units" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "kind" "OrgUnitKind" NOT NULL DEFAULT 'DEPARTMENT',
    "name" TEXT NOT NULL,
    "cost_center_code" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_units_org_id_kind_idx" ON "org_units"("org_id", "kind");

ALTER TABLE "org_units" ADD CONSTRAINT "org_units_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OrgUnitClosure
CREATE TABLE "org_unit_closure" (
    "ancestor_id" TEXT NOT NULL,
    "descendant_id" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "org_unit_closure_pkey" PRIMARY KEY ("ancestor_id","descendant_id")
);

CREATE INDEX "org_unit_closure_descendant_id_idx" ON "org_unit_closure"("descendant_id");

ALTER TABLE "org_unit_closure" ADD CONSTRAINT "org_unit_closure_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "org_unit_closure" ADD CONSTRAINT "org_unit_closure_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Now add Membership FKs for new columns
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_cost_center_unit_id_fkey" FOREIGN KEY ("cost_center_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_line_manager_user_id_fkey" FOREIGN KEY ("line_manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PermissionTemplate
CREATE TABLE "permission_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "population" TEXT NOT NULL,
    "actions" TEXT[],
    "scope_type" TEXT NOT NULL,
    "default_conditions" JSONB,
    "requires_second_factor" BOOLEAN NOT NULL DEFAULT false,
    "step_up_actions" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permission_templates_key_key" ON "permission_templates"("key");

-- Grant
CREATE TABLE "grants" (
    "id" TEXT NOT NULL,
    "subject_user_id" TEXT NOT NULL,
    "template_key" TEXT,
    "actions" TEXT[],
    "scope_type" TEXT NOT NULL,
    "scope_org_id" TEXT,
    "scope_org_unit_id" TEXT,
    "include_descendants" BOOLEAN NOT NULL DEFAULT false,
    "scope_ref_kind" TEXT,
    "scope_ref_id" TEXT,
    "conditions" JSONB,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "delegation_envelope" JSONB,
    "parent_grant_id" TEXT,
    "granted_by_user_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revoked_reason" TEXT,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grants_subject_user_id_scope_org_id_idx" ON "grants"("subject_user_id", "scope_org_id");
CREATE INDEX "grants_scope_org_id_idx" ON "grants"("scope_org_id");
CREATE INDEX "grants_template_key_idx" ON "grants"("template_key");

ALTER TABLE "grants" ADD CONSTRAINT "grants_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grants" ADD CONSTRAINT "grants_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grants" ADD CONSTRAINT "grants_template_key_fkey" FOREIGN KEY ("template_key") REFERENCES "permission_templates"("key") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grants" ADD CONSTRAINT "grants_scope_org_id_fkey" FOREIGN KEY ("scope_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grants" ADD CONSTRAINT "grants_scope_org_unit_id_fkey" FOREIGN KEY ("scope_org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grants" ADD CONSTRAINT "grants_parent_grant_id_fkey" FOREIGN KEY ("parent_grant_id") REFERENCES "grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Assignment
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AssignmentKind" NOT NULL,
    "target_id" TEXT NOT NULL,
    "assigned_by_user_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assignments_user_id_kind_idx" ON "assignments"("user_id", "kind");
CREATE INDEX "assignments_target_id_kind_idx" ON "assignments"("target_id", "kind");

ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ApprovalAuthority
CREATE TABLE "approval_authorities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "org_unit_id" TEXT,
    "include_descendants" BOOLEAN NOT NULL DEFAULT false,
    "categories" TEXT[],
    "max_amount_minor" INTEGER,
    "currency" TEXT DEFAULT 'EUR',
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "delegated_from_id" TEXT,
    "alternate_user_id" TEXT,
    "is_confidential_approver" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_authorities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "approval_authorities_org_id_org_unit_id_idx" ON "approval_authorities"("org_id", "org_unit_id");

ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_alternate_user_id_fkey" FOREIGN KEY ("alternate_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_delegated_from_id_fkey" FOREIGN KEY ("delegated_from_id") REFERENCES "approval_authorities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invitation
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "org_unit_id" TEXT,
    "template_key" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "accepted_user_id" TEXT,
    "invited_by_user_id" TEXT NOT NULL,
    "import_batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_email_org_id_idx" ON "invitations"("email", "org_id");

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SsoConnection
CREATE TABLE "sso_connections" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "protocol" "SsoProtocol" NOT NULL,
    "cognito_provider_name" TEXT NOT NULL,
    "status" "SsoConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata_url" TEXT,
    "metadata_xml" TEXT,
    "oidc_issuer" TEXT,
    "oidc_client_id" TEXT,
    "attribute_mapping" JSONB,
    "idp_initiated_allowed" BOOLEAN NOT NULL DEFAULT false,
    "jit_provisioning" BOOLEAN NOT NULL DEFAULT false,
    "default_org_unit_id" TEXT,
    "certificate_expires_at" TIMESTAMP(3),
    "last_tested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sso_connections_cognito_provider_name_key" ON "sso_connections"("cognito_provider_name");
CREATE INDEX "sso_connections_org_id_idx" ON "sso_connections"("org_id");

ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_default_org_unit_id_fkey" FOREIGN KEY ("default_org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SsoDomain
CREATE TABLE "sso_domains" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "sso_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sso_domains_domain_key" ON "sso_domains"("domain");

ALTER TABLE "sso_domains" ADD CONSTRAINT "sso_domains_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "sso_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EmergencyAccess
CREATE TABLE "emergency_access" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope_kind" "EmergencyScopeKind" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,

    CONSTRAINT "emergency_access_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "emergency_access_user_id_expires_at_idx" ON "emergency_access"("user_id", "expires_at");

ALTER TABLE "emergency_access" ADD CONSTRAINT "emergency_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access" ADD CONSTRAINT "emergency_access_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access" ADD CONSTRAINT "emergency_access_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditEvent (regular table; converted to partitioned in migration 002)
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_user_id" TEXT,
    "actor_kind" "ActorKind" NOT NULL,
    "org_id" TEXT,
    "action" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "details" JSONB NOT NULL,
    "session_id" TEXT,
    "ip_hash" TEXT,
    "user_agent_family" TEXT,
    "retain_until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id","occurred_at")
);

CREATE INDEX "audit_events_actor_user_id_occurred_at_idx" ON "audit_events"("actor_user_id", "occurred_at");
CREATE INDEX "audit_events_org_id_action_occurred_at_idx" ON "audit_events"("org_id", "action", "occurred_at");
CREATE INDEX "audit_events_record_type_record_id_idx" ON "audit_events"("record_type", "record_id");
CREATE INDEX "audit_events_category_retain_until_idx" ON "audit_events"("category", "retain_until");

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ExpertCredential
CREATE TABLE "expert_credentials" (
    "id" TEXT NOT NULL,
    "expert_id" TEXT NOT NULL,
    "service_category" TEXT NOT NULL,
    "status" "ExpertCredentialStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_user_id" TEXT,
    "effective_from" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "expert_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expert_credentials_expert_id_status_idx" ON "expert_credentials"("expert_id", "status");

ALTER TABLE "expert_credentials" ADD CONSTRAINT "expert_credentials_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "experts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expert_credentials" ADD CONSTRAINT "expert_credentials_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RetentionPolicy
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "data_category" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'DEFAULT',
    "service_type" TEXT,
    "min_days" INTEGER NOT NULL,
    "max_days" INTEGER,
    "legal_basis" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retention_policies_data_category_jurisdiction_service_type_key" ON "retention_policies"("data_category", "jurisdiction", "service_type");

-- ═══════════════════════════════════════════════════════════════════
-- Backfill ExpertCredential from existing Expert rows
-- ═══════════════════════════════════════════════════════════════════
-- For each Expert, create one ExpertCredential with serviceCategory
-- set to the lowercase string of Expert.area, status=APPROVED, effectiveFrom=now().

INSERT INTO "expert_credentials" ("id", "expert_id", "service_category", "status", "effective_from")
SELECT
    'ec_' || "id",
    "id",
    LOWER("area"::TEXT),
    'APPROVED'::"ExpertCredentialStatus",
    NOW()
FROM "experts"
ON CONFLICT ("id") DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- Update FK references from old "teams" to "legacy_teams"
-- ═══════════════════════════════════════════════════════════════════
-- The FKs on channels, polls, memberships already point to the underlying
-- table (now renamed). We need to update the constraint names if they
-- reference the old table name. Prisma tracks by constraint name.

-- Drop and recreate FK for channels.team_id
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_team_id_fkey";
ALTER TABLE "channels" ADD CONSTRAINT "channels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "legacy_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop and recreate FK for polls.team_id
ALTER TABLE "polls" DROP CONSTRAINT IF EXISTS "polls_team_id_fkey";
ALTER TABLE "polls" ADD CONSTRAINT "polls_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "legacy_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop and recreate FK for memberships.team_id
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_team_id_fkey";
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "legacy_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
