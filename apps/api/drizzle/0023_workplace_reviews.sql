-- Workplace reviews (ADR 0002, D-EL-03, D-EL-04, D-EL-11, D-EL-12; spec Epics G and H).
-- `review_services` is platform data; the seven other tables are tenant tables
-- under forced row-level security. A shared report version never changes and the
-- reviewer's notes have no employer-facing route. FORCE ROW LEVEL SECURITY is
-- added by hand (drizzle-kit emits ENABLE only), as in 0021 and 0022.
CREATE TYPE "public"."improvement_action_status" AS ENUM('proposed', 'agreed', 'in_progress', 'completed', 'not_proceeding');--> statement-breakpoint
CREATE TYPE "public"."review_engagement_status" AS ENUM('accepted', 'scheduled', 'in_progress', 'report_shared', 'follow_up', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."review_report_status" AS ENUM('draft', 'in_review', 'shared', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."review_request_status" AS ENUM('submitted', 'needs_information', 'in_review', 'scoped', 'converted', 'declined', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."review_scope_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TABLE "improvement_actions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"engagement_id" text NOT NULL,
	"report_version_id" text,
	"dimension_key" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"owner_user_id" text,
	"due_date" timestamp (3) with time zone,
	"intended_check" text NOT NULL,
	"status" "improvement_action_status" DEFAULT 'proposed' NOT NULL,
	"proposed_by_user_id" text NOT NULL,
	"agreed_by_user_id" text,
	"agreed_at" timestamp (3) with time zone,
	"completed_by_user_id" text,
	"completed_at" timestamp (3) with time zone,
	"not_proceeding_reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "improvement_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_engagement_notes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"engagement_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_engagement_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_engagements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"request_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"reviewer_user_id" text,
	"coordinator_user_id" text,
	"status" "review_engagement_status" DEFAULT 'accepted' NOT NULL,
	"appointment_id" text,
	"proposed_windows" jsonb,
	"proposed_time_zone" text,
	"participant_user_id" text,
	"follow_up_target_date" timestamp (3) with time zone,
	"follow_up_owner_user_id" text,
	"follow_up_appointment_id" text,
	"completed_at" timestamp (3) with time zone,
	"canceled_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_engagements_windows_check" CHECK (case when "review_engagements"."proposed_windows" is null then true when jsonb_typeof("review_engagements"."proposed_windows") = 'array' then jsonb_array_length("review_engagements"."proposed_windows") between 1 and 3 else false end)
);
--> statement-breakpoint
ALTER TABLE "review_engagements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_report_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"engagement_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "review_report_status" DEFAULT 'draft' NOT NULL,
	"sections" jsonb NOT NULL,
	"evidence_snapshot_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_user_id" text NOT NULL,
	"shared_at" timestamp (3) with time zone,
	"shared_by_user_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_report_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"requester_user_id" text NOT NULL,
	"snapshot_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"scope_cohort_key" text DEFAULT 'company' NOT NULL,
	"dimension_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"service_id" text,
	"context" text,
	"share_aggregates" boolean DEFAULT false NOT NULL,
	"terms_version" text NOT NULL,
	"notice_version" text NOT NULL,
	"status" "review_request_status" DEFAULT 'submitted' NOT NULL,
	"coordinator_user_id" text,
	"decline_reason" text,
	"information_request" text,
	"information_answer" text,
	"engagement_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_scopes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"request_id" text NOT NULL,
	"version" integer NOT NULL,
	"service_id" text NOT NULL,
	"title" text NOT NULL,
	"deliverables" text NOT NULL,
	"participants" text NOT NULL,
	"price_minor" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"tax_note" text,
	"terms_version" text NOT NULL,
	"valid_until" timestamp (3) with time zone NOT NULL,
	"cancellation_policy" text NOT NULL,
	"status" "review_scope_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"accepted_at" timestamp (3) with time zone,
	"accepted_by_user_id" text,
	"rejected_at" timestamp (3) with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_scopes_price_check" CHECK ("review_scopes"."price_minor" is null or "review_scopes"."price_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "review_scopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_services" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price_minor" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"introductory" boolean DEFAULT false NOT NULL,
	"terms_version" text NOT NULL,
	"terms_text" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_services_duration_check" CHECK ("review_services"."duration_minutes" > 0),
	CONSTRAINT "review_services_price_check" CHECK ("review_services"."price_minor" is null or "review_services"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "review_sharing_grants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"engagement_id" text NOT NULL,
	"snapshot_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"cohort_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"revoked_by_user_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_sharing_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_engagement_id_review_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."review_engagements"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_report_version_id_review_report_versions_id_fk" FOREIGN KEY ("report_version_id") REFERENCES "public"."review_report_versions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_agreed_by_user_id_users_id_fk" FOREIGN KEY ("agreed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagement_notes" ADD CONSTRAINT "review_engagement_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagement_notes" ADD CONSTRAINT "review_engagement_notes_engagement_id_review_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."review_engagements"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagement_notes" ADD CONSTRAINT "review_engagement_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_scope_id_review_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."review_scopes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_coordinator_user_id_users_id_fk" FOREIGN KEY ("coordinator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_participant_user_id_users_id_fk" FOREIGN KEY ("participant_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_follow_up_owner_user_id_users_id_fk" FOREIGN KEY ("follow_up_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_engagements" ADD CONSTRAINT "review_engagements_follow_up_appointment_id_appointments_id_fk" FOREIGN KEY ("follow_up_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_report_versions" ADD CONSTRAINT "review_report_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_report_versions" ADD CONSTRAINT "review_report_versions_engagement_id_review_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."review_engagements"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_report_versions" ADD CONSTRAINT "review_report_versions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_report_versions" ADD CONSTRAINT "review_report_versions_shared_by_user_id_users_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_service_id_review_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."review_services"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_coordinator_user_id_users_id_fk" FOREIGN KEY ("coordinator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_scopes" ADD CONSTRAINT "review_scopes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_scopes" ADD CONSTRAINT "review_scopes_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_scopes" ADD CONSTRAINT "review_scopes_service_id_review_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."review_services"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_scopes" ADD CONSTRAINT "review_scopes_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_scopes" ADD CONSTRAINT "review_scopes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_sharing_grants" ADD CONSTRAINT "review_sharing_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_sharing_grants" ADD CONSTRAINT "review_sharing_grants_engagement_id_review_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."review_engagements"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_sharing_grants" ADD CONSTRAINT "review_sharing_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_sharing_grants" ADD CONSTRAINT "review_sharing_grants_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "improvement_actions_engagement_id_idx" ON "improvement_actions" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "review_engagement_notes_engagement_id_idx" ON "review_engagement_notes" USING btree ("engagement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_engagements_request_id_key" ON "review_engagements" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "review_engagements_org_id_status_idx" ON "review_engagements" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "review_engagements_reviewer_user_id_idx" ON "review_engagements" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_report_versions_engagement_id_version_key" ON "review_report_versions" USING btree ("engagement_id","version");--> statement-breakpoint
CREATE INDEX "review_requests_org_id_status_idx" ON "review_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "review_requests_status_created_at_idx" ON "review_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_active_scope_key" ON "review_requests" USING btree ("org_id","scope_cohort_key") WHERE "review_requests"."status" in ('submitted', 'needs_information', 'in_review', 'scoped');--> statement-breakpoint
CREATE UNIQUE INDEX "review_scopes_request_id_version_key" ON "review_scopes" USING btree ("request_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "review_services_key_key" ON "review_services" USING btree ("key");--> statement-breakpoint
CREATE INDEX "review_sharing_grants_engagement_id_idx" ON "review_sharing_grants" USING btree ("engagement_id");--> statement-breakpoint
CREATE POLICY "improvement_actions_tenant_isolation" ON "improvement_actions" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "improvement_actions"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "improvement_actions"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "review_engagement_notes_tenant_isolation" ON "review_engagement_notes" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_engagement_notes"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_engagement_notes"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "review_engagements_tenant_isolation" ON "review_engagements" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_engagements"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_engagements"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "review_report_versions_tenant_isolation" ON "review_report_versions" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_report_versions"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_report_versions"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "review_requests_tenant_isolation" ON "review_requests" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_requests"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_requests"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "review_scopes_tenant_isolation" ON "review_scopes" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_scopes"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_scopes"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "review_sharing_grants_tenant_isolation" ON "review_sharing_grants" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_sharing_grants"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "review_sharing_grants"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "review_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_scopes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_engagements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_sharing_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_report_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_engagement_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "improvement_actions" FORCE ROW LEVEL SECURITY;
