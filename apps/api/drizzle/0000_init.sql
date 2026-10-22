CREATE TYPE "public"."actor_kind" AS ENUM('USER', 'SYSTEM', 'JOB');--> statement-breakpoint
CREATE TYPE "public"."assignment_kind" AS ENUM('CASE', 'QUEUE', 'CLIENT', 'PRACTICE_GROUP', 'COLLECTION', 'SUPPORT_CASE', 'SUPERVISION', 'ACTIVITY');--> statement-breakpoint
CREATE TYPE "public"."audit_category" AS ENUM('SECURITY', 'AUTHORIZATION', 'FINANCIAL', 'CONTENT_ACCESS', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('ALLOWED', 'DENIED', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."channel_scope" AS ENUM('ORGANIZATION', 'TEAM');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('ARTICLE', 'FAQ', 'VIDEO');--> statement-breakpoint
CREATE TYPE "public"."emergency_scope_kind" AS ENUM('CASE', 'USER_RECORDS');--> statement-breakpoint
CREATE TYPE "public"."event_request_status" AS ENUM('REQUESTED', 'OFFERS_READY', 'SELECTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."expert_credential_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."lead_kind" AS ENUM('DEMO_REQUEST', 'CONTACT', 'WEBINAR_REGISTRATION');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('INVITED', 'ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('EMPLOYEE', 'MANAGER', 'HR_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."org_unit_kind" AS ENUM('COMPANY', 'DEPARTMENT', 'TEAM');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('EXPERT', 'OPERATIONS', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."sso_connection_status" AS ENUM('DRAFT', 'TESTING', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."sso_protocol" AS ENUM('SAML', 'OIDC');--> statement-breakpoint
CREATE TYPE "public"."support_area" AS ENUM('PSYCHOLOGICAL', 'LEGAL', 'FINANCIAL');--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"cognito_username" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"locale" text DEFAULT 'sr-Latn' NOT NULL,
	"email_verified_at" timestamp (3) with time zone,
	"suspended_at" timestamp (3) with time zone,
	"deactivated_at" timestamp (3) with time zone,
	"last_sign_in_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"platform_role" "platform_role",
	CONSTRAINT "users_email_lowercase_check" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "legacy_teams" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"org_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"org_unit_id" text,
	"cost_center_unit_id" text,
	"line_manager_user_id" text,
	"status" "membership_status" DEFAULT 'INVITED' NOT NULL,
	"start_date" timestamp (3) with time zone NOT NULL,
	"end_date" timestamp (3) with time zone,
	"ended_reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"role" "org_role" DEFAULT 'EMPLOYEE' NOT NULL,
	"team_id" text
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_unit_closure" (
	"ancestor_id" text NOT NULL,
	"descendant_id" text NOT NULL,
	"depth" integer NOT NULL,
	CONSTRAINT "org_unit_closure_ancestor_id_descendant_id_pk" PRIMARY KEY("ancestor_id","descendant_id")
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"parent_id" text,
	"kind" "org_unit_kind" DEFAULT 'DEPARTMENT' NOT NULL,
	"name" text NOT NULL,
	"cost_center_code" text,
	"archived_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text DEFAULT 'RS' NOT NULL,
	"timezone" text DEFAULT 'Europe/Belgrade' NOT NULL,
	"contract_start" timestamp (3) with time zone,
	"contract_end" timestamp (3) with time zone,
	"owner_user_id" text,
	"self_approval_allowed" boolean DEFAULT false NOT NULL,
	"financial_step_up_threshold_minor" integer,
	"cohort_threshold" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_authorities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"org_unit_id" text,
	"include_descendants" boolean DEFAULT false NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_amount_minor" integer,
	"currency" text DEFAULT 'EUR',
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"delegated_from_id" text,
	"alternate_user_id" text,
	"is_confidential_approver" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_authorities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "assignment_kind" NOT NULL,
	"target_id" text NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"start_at" timestamp (3) with time zone NOT NULL,
	"end_at" timestamp (3) with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "emergency_access" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"scope_kind" "emergency_scope_kind" NOT NULL,
	"scope_id" text NOT NULL,
	"granted_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"revoked_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"subject_user_id" text NOT NULL,
	"template_key" text,
	"actions" text[] DEFAULT '{}'::text[] NOT NULL,
	"scope_type" text NOT NULL,
	"scope_org_id" text,
	"scope_org_unit_id" text,
	"include_descendants" boolean DEFAULT false NOT NULL,
	"scope_ref_kind" text,
	"scope_ref_id" text,
	"conditions" jsonb,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"delegation_envelope" jsonb,
	"parent_grant_id" text,
	"granted_by_user_id" text NOT NULL,
	"granted_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"revoked_by_user_id" text,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "permission_templates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"workspace" text NOT NULL,
	"population" text NOT NULL,
	"actions" text[] DEFAULT '{}'::text[] NOT NULL,
	"scope_type" text NOT NULL,
	"default_conditions" jsonb,
	"requires_second_factor" boolean DEFAULT false NOT NULL,
	"step_up_actions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_templates_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"email" text NOT NULL,
	"org_id" text NOT NULL,
	"org_unit_id" text,
	"template_key" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"accepted_at" timestamp (3) with time zone,
	"accepted_user_id" text,
	"invited_by_user_id" text NOT NULL,
	"import_batch_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso_connections" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"protocol" "sso_protocol" NOT NULL,
	"cognito_provider_name" text NOT NULL,
	"status" "sso_connection_status" DEFAULT 'DRAFT' NOT NULL,
	"metadata_url" text,
	"metadata_xml" text,
	"oidc_issuer" text,
	"oidc_client_id" text,
	"attribute_mapping" jsonb,
	"idp_initiated_allowed" boolean DEFAULT false NOT NULL,
	"jit_provisioning" boolean DEFAULT false NOT NULL,
	"default_org_unit_id" text,
	"certificate_expires_at" timestamp (3) with time zone,
	"last_tested_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sso_domains" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"connection_id" text NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text DEFAULT gen_random_uuid()::text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"actor_user_id" text,
	"actor_kind" "actor_kind" NOT NULL,
	"org_id" text,
	"action" text NOT NULL,
	"record_type" text NOT NULL,
	"record_id" text NOT NULL,
	"result" "audit_result" NOT NULL,
	"category" "audit_category" NOT NULL,
	"details" jsonb NOT NULL,
	"session_id" text,
	"ip_hash" text,
	"user_agent_family" text,
	"retain_until" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "audit_events_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"data_category" text NOT NULL,
	"jurisdiction" text DEFAULT 'DEFAULT' NOT NULL,
	"service_type" text,
	"min_days" integer NOT NULL,
	"max_days" integer,
	"legal_basis" text NOT NULL,
	"effective_from" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"scope" "channel_scope" NOT NULL,
	"org_id" text NOT NULL,
	"team_id" text
);
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"kind" "content_kind" NOT NULL,
	"area" "support_area" NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"expert_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"participants" integer NOT NULL,
	"location" text NOT NULL,
	"date_range" text NOT NULL,
	"budget" text NOT NULL,
	"purpose" text NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "event_request_status" DEFAULT 'REQUESTED' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expert_credentials" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"expert_id" text NOT NULL,
	"service_category" text NOT NULL,
	"status" "expert_credential_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reviewed_by_user_id" text,
	"effective_from" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "experts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"area" "support_area" NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"bio" text
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"kind" "lead_kind" NOT NULL,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"source" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_options" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"label" text NOT NULL,
	"poll_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"option_id" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"question" text NOT NULL,
	"team_id" text NOT NULL,
	"closes_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"body" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "legacy_teams" ADD CONSTRAINT "legacy_teams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_cost_center_unit_id_org_units_id_fk" FOREIGN KEY ("cost_center_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_line_manager_user_id_users_id_fk" FOREIGN KEY ("line_manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_legacy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."legacy_teams"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "org_unit_closure" ADD CONSTRAINT "org_unit_closure_ancestor_id_org_units_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "org_unit_closure" ADD CONSTRAINT "org_unit_closure_descendant_id_org_units_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_delegated_from_id_approval_authorities_id_fk" FOREIGN KEY ("delegated_from_id") REFERENCES "public"."approval_authorities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "approval_authorities" ADD CONSTRAINT "approval_authorities_alternate_user_id_users_id_fk" FOREIGN KEY ("alternate_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "emergency_access" ADD CONSTRAINT "emergency_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "emergency_access" ADD CONSTRAINT "emergency_access_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "emergency_access" ADD CONSTRAINT "emergency_access_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_template_key_permission_templates_key_fk" FOREIGN KEY ("template_key") REFERENCES "public"."permission_templates"("key") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_scope_org_id_organizations_id_fk" FOREIGN KEY ("scope_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_scope_org_unit_id_org_units_id_fk" FOREIGN KEY ("scope_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_parent_grant_id_grants_id_fk" FOREIGN KEY ("parent_grant_id") REFERENCES "public"."grants"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_default_org_unit_id_org_units_id_fk" FOREIGN KEY ("default_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sso_domains" ADD CONSTRAINT "sso_domains_connection_id_sso_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sso_connections"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_team_id_legacy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."legacy_teams"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expert_credentials" ADD CONSTRAINT "expert_credentials_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expert_credentials" ADD CONSTRAINT "expert_credentials_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_id_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."poll_options"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_team_id_legacy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."legacy_teams"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_provider_subject_key" ON "external_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "external_identities_user_id_idx" ON "external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_id_org_id_start_date_key" ON "memberships" USING btree ("user_id","org_id","start_date");--> statement-breakpoint
CREATE INDEX "memberships_org_id_status_idx" ON "memberships" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_memberships_one_active" ON "memberships" USING btree ("user_id","org_id") WHERE "memberships"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_memberships_active_org" ON "memberships" USING btree ("org_id") WHERE "memberships"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "org_unit_closure_descendant_id_idx" ON "org_unit_closure" USING btree ("descendant_id");--> statement-breakpoint
CREATE INDEX "org_units_org_id_kind_idx" ON "org_units" USING btree ("org_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "approval_authorities_org_id_org_unit_id_idx" ON "approval_authorities" USING btree ("org_id","org_unit_id");--> statement-breakpoint
CREATE INDEX "assignments_user_id_kind_idx" ON "assignments" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "assignments_target_id_kind_idx" ON "assignments" USING btree ("target_id","kind");--> statement-breakpoint
CREATE INDEX "emergency_access_user_id_expires_at_idx" ON "emergency_access" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_emergency_active" ON "emergency_access" USING btree ("user_id") WHERE "emergency_access"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "grants_subject_user_id_scope_org_id_idx" ON "grants" USING btree ("subject_user_id","scope_org_id");--> statement-breakpoint
CREATE INDEX "grants_scope_org_id_idx" ON "grants" USING btree ("scope_org_id");--> statement-breakpoint
CREATE INDEX "grants_template_key_idx" ON "grants" USING btree ("template_key");--> statement-breakpoint
CREATE INDEX "idx_grants_active" ON "grants" USING btree ("subject_user_id","scope_org_id") WHERE "grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_org_id_idx" ON "invitations" USING btree ("email","org_id");--> statement-breakpoint
CREATE INDEX "idx_invitations_pending" ON "invitations" USING btree ("email","org_id") WHERE "invitations"."revoked_at" IS NULL AND "invitations"."accepted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_connections_cognito_provider_name_key" ON "sso_connections" USING btree ("cognito_provider_name");--> statement-breakpoint
CREATE INDEX "sso_connections_org_id_idx" ON "sso_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_domains_domain_key" ON "sso_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_audit_actor_time" ON "audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_audit_org_action_time" ON "audit_events" USING btree ("org_id","action","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_audit_record" ON "audit_events" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "idx_audit_retention" ON "audit_events" USING btree ("category","retain_until");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_data_category_jurisdiction_service_type_key" ON "retention_policies" USING btree ("data_category","jurisdiction","service_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_retention_policy_no_service" ON "retention_policies" USING btree ("data_category","jurisdiction") WHERE "retention_policies"."service_type" IS NULL;--> statement-breakpoint
CREATE INDEX "expert_credentials_expert_id_status_idx" ON "expert_credentials" USING btree ("expert_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "experts_user_id_key" ON "experts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leads_kind_created_at_idx" ON "leads" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_option_id_user_id_key" ON "poll_votes" USING btree ("option_id","user_id");--> statement-breakpoint
CREATE VIEW "public"."teams" AS (select "id", "name", "org_id" from "org_units" where "kind" = 'TEAM');--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "memberships"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "memberships"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "org_units_tenant_isolation" ON "org_units" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "org_units"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "org_units"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "approval_authorities_tenant_isolation" ON "approval_authorities" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "approval_authorities"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "approval_authorities"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "grants_tenant_isolation" ON "grants" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "grants"."scope_org_id" IS NULL OR "grants"."scope_org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "grants"."scope_org_id" IS NULL OR "grants"."scope_org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "invitations_tenant_isolation" ON "invitations" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "invitations"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "invitations"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "sso_connections_tenant_isolation" ON "sso_connections" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "sso_connections"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "sso_connections"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "channels_tenant_isolation" ON "channels" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "channels"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "channels"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "event_requests_tenant_isolation" ON "event_requests" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "event_requests"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "event_requests"."org_id" = current_setting('app.current_org_id', true)));