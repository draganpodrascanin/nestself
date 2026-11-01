-- Employee listening (ADR 0002, D-EL-01; spec section 9): questionnaire
-- versions (platform data), per-client configuration and policy versions,
-- survey cycles, the restricted participation link, private drafts, the
-- answers without an identity column, the published snapshots with their
-- aggregate cells and disclosure decisions, and offer dismissals. Generated
-- from the Drizzle schema, then edited by hand: the FORCE statements at the
-- end bind the owner role to the tenant policies as nestself_app is bound
-- (see 0001). `survey_responses` has no user or membership column on purpose.
CREATE TYPE "public"."questionnaire_status" AS ENUM('draft', 'in_review', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."survey_cycle_status" AS ENUM('scheduled', 'open', 'closing', 'published', 'canceled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."survey_participation_state" AS ENUM('invited', 'draft', 'submitted', 'ineligible');--> statement-breakpoint
CREATE TABLE "listening_configurations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"measurement_from" timestamp (3) with time zone,
	"measurement_until" timestamp (3) with time zone,
	"feedback_from" timestamp (3) with time zone,
	"feedback_until" timestamp (3) with time zone,
	"workplace_reviews_from" timestamp (3) with time zone,
	"workplace_reviews_until" timestamp (3) with time zone,
	"feedback_sensitive_enabled" boolean DEFAULT false NOT NULL,
	"cadence_days" integer DEFAULT 14 NOT NULL,
	"response_window_days" integer DEFAULT 7 NOT NULL,
	"reminder_limit" integer DEFAULT 2 NOT NULL,
	"freshness_days" integer DEFAULT 45 NOT NULL,
	"minimum_cohort" integer DEFAULT 10 NOT NULL,
	"good_threshold_tenths" integer DEFAULT 750 NOT NULL,
	"monitor_threshold_tenths" integer DEFAULT 600 NOT NULL,
	"algorithm_version" integer DEFAULT 1 NOT NULL,
	"questionnaire_version_id" text,
	"next_launch_at" timestamp (3) with time zone,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listening_configurations_minimum_cohort_check" CHECK ("listening_configurations"."minimum_cohort" >= 10),
	CONSTRAINT "listening_configurations_thresholds_check" CHECK ("listening_configurations"."monitor_threshold_tenths" < "listening_configurations"."good_threshold_tenths"),
	CONSTRAINT "listening_configurations_reminder_limit_check" CHECK ("listening_configurations"."reminder_limit" between 0 and 2)
);
--> statement-breakpoint
ALTER TABLE "listening_configurations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listening_policy_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"cadence_days" integer NOT NULL,
	"response_window_days" integer NOT NULL,
	"reminder_limit" integer NOT NULL,
	"freshness_days" integer NOT NULL,
	"minimum_cohort" integer NOT NULL,
	"good_threshold_tenths" integer NOT NULL,
	"monitor_threshold_tenths" integer NOT NULL,
	"algorithm_version" integer NOT NULL,
	"questionnaire_version_id" text,
	"effective_from" timestamp (3) with time zone NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listening_policy_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "questionnaire_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"version" integer NOT NULL,
	"status" "questionnaire_status" DEFAULT 'draft' NOT NULL,
	"dimensions" jsonb NOT NULL,
	"notice" jsonb NOT NULL,
	"comparable_with_version_id" text,
	"created_by_user_id" text NOT NULL,
	"published_by_user_id" text,
	"published_at" timestamp (3) with time zone,
	"archived_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_aggregate_cells" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"snapshot_id" text NOT NULL,
	"org_id" text NOT NULL,
	"cohort_key" text NOT NULL,
	"cohort_unit_id" text,
	"dimension_key" text NOT NULL,
	"valid_count" integer NOT NULL,
	"favorable_count" integer NOT NULL,
	"neutral_count" integer NOT NULL,
	"unfavorable_count" integer NOT NULL,
	"score_tenths" integer,
	"status" text,
	"suppression" text,
	CONSTRAINT "survey_aggregate_cells_status_check" CHECK ("survey_aggregate_cells"."status" is null or "survey_aggregate_cells"."status" in ('good','monitor','danger')),
	CONSTRAINT "survey_aggregate_cells_suppression_check" CHECK ("survey_aggregate_cells"."suppression" is null or "survey_aggregate_cells"."suppression" in ('primary','secondary'))
);
--> statement-breakpoint
ALTER TABLE "survey_aggregate_cells" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "survey_cycles" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"questionnaire_version_id" text NOT NULL,
	"policy_version_id" text NOT NULL,
	"opens_at" timestamp (3) with time zone NOT NULL,
	"closes_at" timestamp (3) with time zone NOT NULL,
	"status" "survey_cycle_status" DEFAULT 'scheduled' NOT NULL,
	"audience_size" integer,
	"launched_at" timestamp (3) with time zone,
	"finalized_at" timestamp (3) with time zone,
	"canceled_at" timestamp (3) with time zone,
	"failure_reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_cycles_window_check" CHECK ("survey_cycles"."closes_at" > "survey_cycles"."opens_at")
);
--> statement-breakpoint
ALTER TABLE "survey_cycles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "survey_drafts" (
	"participation_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "survey_offer_dismissals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"user_id" text NOT NULL,
	"dismissed_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_offer_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "survey_participations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"user_id" text NOT NULL,
	"cohort_unit_id" text,
	"state" "survey_participation_state" DEFAULT 'invited' NOT NULL,
	"response_id" text,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp (3) with time zone,
	"submitted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_participations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"questionnaire_version_id" text NOT NULL,
	"cohort_unit_id" text,
	"answers" jsonb NOT NULL,
	"accepted_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "survey_snapshots" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"algorithm_version" integer NOT NULL,
	"policy_version_id" text NOT NULL,
	"questionnaire_version_id" text NOT NULL,
	"audience_size" integer NOT NULL,
	"submitted_count" integer NOT NULL,
	"published_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listening_configurations" ADD CONSTRAINT "listening_configurations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "listening_configurations" ADD CONSTRAINT "listening_configurations_questionnaire_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "listening_configurations" ADD CONSTRAINT "listening_configurations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "listening_policy_versions" ADD CONSTRAINT "listening_policy_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "listening_policy_versions" ADD CONSTRAINT "listening_policy_versions_questionnaire_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "listening_policy_versions" ADD CONSTRAINT "listening_policy_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_comparable_with_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("comparable_with_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_aggregate_cells" ADD CONSTRAINT "survey_aggregate_cells_snapshot_id_survey_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."survey_snapshots"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_aggregate_cells" ADD CONSTRAINT "survey_aggregate_cells_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_cycles" ADD CONSTRAINT "survey_cycles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_cycles" ADD CONSTRAINT "survey_cycles_questionnaire_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_cycles" ADD CONSTRAINT "survey_cycles_policy_version_id_listening_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."listening_policy_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_drafts" ADD CONSTRAINT "survey_drafts_participation_id_survey_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."survey_participations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_drafts" ADD CONSTRAINT "survey_drafts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_offer_dismissals" ADD CONSTRAINT "survey_offer_dismissals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_offer_dismissals" ADD CONSTRAINT "survey_offer_dismissals_snapshot_id_survey_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."survey_snapshots"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_offer_dismissals" ADD CONSTRAINT "survey_offer_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_participations" ADD CONSTRAINT "survey_participations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_participations" ADD CONSTRAINT "survey_participations_cycle_id_survey_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."survey_cycles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_participations" ADD CONSTRAINT "survey_participations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_participations" ADD CONSTRAINT "survey_participations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_cycle_id_survey_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."survey_cycles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_questionnaire_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_snapshots" ADD CONSTRAINT "survey_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_snapshots" ADD CONSTRAINT "survey_snapshots_cycle_id_survey_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."survey_cycles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_snapshots" ADD CONSTRAINT "survey_snapshots_policy_version_id_listening_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."listening_policy_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "survey_snapshots" ADD CONSTRAINT "survey_snapshots_questionnaire_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "listening_configurations_org_id_key" ON "listening_configurations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listening_policy_versions_org_id_policy_version_key" ON "listening_policy_versions" USING btree ("org_id","policy_version");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_versions_version_key" ON "questionnaire_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_aggregate_cells_snapshot_cohort_dimension_key" ON "survey_aggregate_cells" USING btree ("snapshot_id","cohort_key","dimension_key");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_cycles_org_id_opens_at_key" ON "survey_cycles" USING btree ("org_id","opens_at");--> statement-breakpoint
CREATE INDEX "survey_cycles_status_closes_at_idx" ON "survey_cycles" USING btree ("status","closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_offer_dismissals_snapshot_id_user_id_key" ON "survey_offer_dismissals" USING btree ("snapshot_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_participations_cycle_id_membership_id_key" ON "survey_participations" USING btree ("cycle_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_participations_cycle_id_user_id_key" ON "survey_participations" USING btree ("cycle_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_participations_response_id_key" ON "survey_participations" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "survey_participations_cycle_id_state_idx" ON "survey_participations" USING btree ("cycle_id","state");--> statement-breakpoint
CREATE INDEX "survey_responses_cycle_id_idx" ON "survey_responses" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_snapshots_cycle_id_key" ON "survey_snapshots" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "survey_snapshots_org_id_published_at_idx" ON "survey_snapshots" USING btree ("org_id","published_at");--> statement-breakpoint
CREATE POLICY "listening_configurations_tenant_isolation" ON "listening_configurations" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "listening_configurations"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "listening_configurations"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "listening_policy_versions_tenant_isolation" ON "listening_policy_versions" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "listening_policy_versions"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "listening_policy_versions"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "survey_aggregate_cells_tenant_isolation" ON "survey_aggregate_cells" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_aggregate_cells"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_aggregate_cells"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "survey_cycles_tenant_isolation" ON "survey_cycles" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_cycles"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_cycles"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "survey_drafts_tenant_isolation" ON "survey_drafts" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_drafts"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_drafts"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "survey_offer_dismissals_tenant_isolation" ON "survey_offer_dismissals" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_offer_dismissals"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_offer_dismissals"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "survey_participations_tenant_isolation" ON "survey_participations" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_participations"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_participations"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "survey_responses_tenant_isolation" ON "survey_responses" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_responses"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_responses"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "survey_snapshots_tenant_isolation" ON "survey_snapshots" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_snapshots"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "survey_snapshots"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "listening_configurations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listening_policy_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_cycles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_participations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_aggregate_cells" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "survey_offer_dismissals" FORCE ROW LEVEL SECURITY;
