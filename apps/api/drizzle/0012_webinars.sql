-- Webinars (T-CW-2.1, NS-CALLS-01, D-CW-14 to D-CW-18, D-CW-25, D-CW-34,
-- D-CW-35): occurrences, hosts, registrations, the moderated chat, polls with
-- anonymous votes, and the recording pipeline state. Every table carries a
-- nullable org_id under a tenant policy that keeps platform-wide rows (an
-- occurrence open to all eligible organisations) visible in every tenant
-- context (CW-R-23); audience eligibility is the service's job. Generated from
-- the Drizzle schema; the FORCE statements at the end are hand-written so the
-- owner role is bound by the same policies as nestself_app (see 0001, CW-R-25).
CREATE TYPE "public"."webinar_message_kind" AS ENUM('HOST', 'ATTENDEE', 'QUESTION');--> statement-breakpoint
CREATE TYPE "public"."webinar_message_status" AS ENUM('PENDING', 'PUBLISHED', 'ANSWERED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."webinar_status" AS ENUM('DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'CANCELED');--> statement-breakpoint
CREATE TABLE "webinar_hosts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"webinar_id" text NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"role" "call_participant_role" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webinar_hosts_role_check" CHECK ("webinar_hosts"."role" IN ('PRESENTER', 'MODERATOR'))
);
--> statement-breakpoint
ALTER TABLE "webinar_hosts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webinar_messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"webinar_id" text NOT NULL,
	"org_id" text,
	"session_id" text,
	"author_participant_id" text,
	"author_user_id" text NOT NULL,
	"kind" "webinar_message_kind" NOT NULL,
	"status" "webinar_message_status" DEFAULT 'PENDING' NOT NULL,
	"text" text NOT NULL,
	"original_text" text,
	"show_first_name" boolean DEFAULT false NOT NULL,
	"author_first_name" text,
	"published_at" timestamp (3) with time zone,
	"published_by_user_id" text,
	"answer_text" text,
	"answered_by_user_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webinar_messages_text_length_check" CHECK (char_length("webinar_messages"."text") BETWEEN 1 AND 1000),
	CONSTRAINT "webinar_messages_original_text_length_check" CHECK ("webinar_messages"."original_text" IS NULL OR char_length("webinar_messages"."original_text") BETWEEN 1 AND 1000),
	CONSTRAINT "webinar_messages_answer_text_check" CHECK (("webinar_messages"."status" = 'ANSWERED') = ("webinar_messages"."answer_text" IS NOT NULL) AND ("webinar_messages"."answer_text" IS NULL OR char_length("webinar_messages"."answer_text") BETWEEN 1 AND 2000)),
	CONSTRAINT "webinar_messages_host_published_check" CHECK ("webinar_messages"."kind" <> 'HOST' OR "webinar_messages"."status" = 'PUBLISHED'),
	CONSTRAINT "webinar_messages_first_name_check" CHECK ("webinar_messages"."kind" = 'HOST' OR "webinar_messages"."show_first_name" = ("webinar_messages"."author_first_name" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "webinar_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webinar_poll_options" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"poll_id" text NOT NULL,
	"org_id" text,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "webinar_poll_options_label_length_check" CHECK (char_length("webinar_poll_options"."label") BETWEEN 1 AND 120),
	CONSTRAINT "webinar_poll_options_position_check" CHECK ("webinar_poll_options"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "webinar_poll_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webinar_poll_results" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"poll_id" text NOT NULL,
	"option_id" text NOT NULL,
	"org_id" text
);
--> statement-breakpoint
ALTER TABLE "webinar_poll_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webinar_polls" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"webinar_id" text NOT NULL,
	"org_id" text,
	"session_id" text,
	"question" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"opened_at" timestamp (3) with time zone,
	"closed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webinar_polls_question_length_check" CHECK (char_length("webinar_polls"."question") BETWEEN 1 AND 300),
	CONSTRAINT "webinar_polls_closed_after_open_check" CHECK ("webinar_polls"."closed_at" IS NULL OR "webinar_polls"."opened_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "webinar_polls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webinar_recordings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"webinar_id" text NOT NULL,
	"org_id" text,
	"session_id" text NOT NULL,
	"status" "recording_status" DEFAULT 'SCHEDULED' NOT NULL,
	"provider_pipeline_id" text,
	"raw_segments_prefix" text,
	"concatenated_key" text,
	"handoff_status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp (3) with time zone,
	"stopped_at" timestamp (3) with time zone,
	"ready_at" timestamp (3) with time zone,
	"handed_off_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webinar_recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webinar_registrations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"webinar_id" text NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"registered_at" timestamp (3) with time zone NOT NULL,
	"joined_at" timestamp (3) with time zone,
	"left_at" timestamp (3) with time zone,
	"attended_minutes" integer,
	"canceled_at" timestamp (3) with time zone,
	"hand_raised_at" timestamp (3) with time zone,
	"floor_given_at" timestamp (3) with time zone,
	"voted_poll_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webinar_registrations_attended_minutes_check" CHECK ("webinar_registrations"."attended_minutes" IS NULL OR "webinar_registrations"."attended_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "webinar_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webinars" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text,
	"title" jsonb NOT NULL,
	"description" jsonb,
	"audience_policy" jsonb NOT NULL,
	"capacity" integer DEFAULT 250 NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"status" "webinar_status" DEFAULT 'DRAFT' NOT NULL,
	"recording_status" "recording_status" DEFAULT 'SCHEDULED' NOT NULL,
	"chat_policy" text DEFAULT 'moderated' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"started_at" timestamp (3) with time zone,
	"ended_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webinars_ends_after_starts_check" CHECK ("webinars"."ends_at" > "webinars"."starts_at"),
	CONSTRAINT "webinars_capacity_check" CHECK ("webinars"."capacity" BETWEEN 1 AND 1000),
	CONSTRAINT "webinars_chat_policy_check" CHECK ("webinars"."chat_policy" = 'moderated')
);
--> statement-breakpoint
ALTER TABLE "webinars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_hosts" ADD CONSTRAINT "webinar_hosts_webinar_id_webinars_id_fk" FOREIGN KEY ("webinar_id") REFERENCES "public"."webinars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_hosts" ADD CONSTRAINT "webinar_hosts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_hosts" ADD CONSTRAINT "webinar_hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_webinar_id_webinars_id_fk" FOREIGN KEY ("webinar_id") REFERENCES "public"."webinars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_author_participant_id_call_participants_id_fk" FOREIGN KEY ("author_participant_id") REFERENCES "public"."call_participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_answered_by_user_id_users_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_poll_options" ADD CONSTRAINT "webinar_poll_options_poll_id_webinar_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."webinar_polls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_poll_options" ADD CONSTRAINT "webinar_poll_options_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_poll_results" ADD CONSTRAINT "webinar_poll_results_poll_id_webinar_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."webinar_polls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_poll_results" ADD CONSTRAINT "webinar_poll_results_option_id_webinar_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."webinar_poll_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_poll_results" ADD CONSTRAINT "webinar_poll_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_polls" ADD CONSTRAINT "webinar_polls_webinar_id_webinars_id_fk" FOREIGN KEY ("webinar_id") REFERENCES "public"."webinars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_polls" ADD CONSTRAINT "webinar_polls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_polls" ADD CONSTRAINT "webinar_polls_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_polls" ADD CONSTRAINT "webinar_polls_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD CONSTRAINT "webinar_recordings_webinar_id_webinars_id_fk" FOREIGN KEY ("webinar_id") REFERENCES "public"."webinars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD CONSTRAINT "webinar_recordings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD CONSTRAINT "webinar_recordings_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_webinar_id_webinars_id_fk" FOREIGN KEY ("webinar_id") REFERENCES "public"."webinars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webinar_hosts_webinar_id_user_id_idx" ON "webinar_hosts" USING btree ("webinar_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webinar_hosts_moderator_idx" ON "webinar_hosts" USING btree ("webinar_id") WHERE role = 'MODERATOR';--> statement-breakpoint
CREATE INDEX "webinar_hosts_user_id_idx" ON "webinar_hosts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webinar_messages_webinar_id_created_at_idx" ON "webinar_messages" USING btree ("webinar_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "webinar_poll_options_poll_id_position_idx" ON "webinar_poll_options" USING btree ("poll_id","position");--> statement-breakpoint
CREATE INDEX "webinar_poll_results_poll_id_option_id_idx" ON "webinar_poll_results" USING btree ("poll_id","option_id");--> statement-breakpoint
CREATE INDEX "webinar_polls_webinar_id_idx" ON "webinar_polls" USING btree ("webinar_id");--> statement-breakpoint
CREATE INDEX "webinar_recordings_webinar_id_idx" ON "webinar_recordings" USING btree ("webinar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webinar_recordings_session_id_idx" ON "webinar_recordings" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webinar_registrations_user_idx" ON "webinar_registrations" USING btree ("webinar_id","user_id");--> statement-breakpoint
CREATE INDEX "webinar_registrations_user_id_idx" ON "webinar_registrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webinars_status_starts_at_idx" ON "webinars" USING btree ("status","starts_at","id");--> statement-breakpoint
CREATE INDEX "webinars_org_id_idx" ON "webinars" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "webinar_hosts_tenant_isolation" ON "webinar_hosts" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_hosts"."org_id" IS NULL OR "webinar_hosts"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_hosts"."org_id" IS NULL OR "webinar_hosts"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "webinar_messages_tenant_isolation" ON "webinar_messages" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_messages"."org_id" IS NULL OR "webinar_messages"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_messages"."org_id" IS NULL OR "webinar_messages"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "webinar_poll_options_tenant_isolation" ON "webinar_poll_options" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_poll_options"."org_id" IS NULL OR "webinar_poll_options"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_poll_options"."org_id" IS NULL OR "webinar_poll_options"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "webinar_poll_results_tenant_isolation" ON "webinar_poll_results" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_poll_results"."org_id" IS NULL OR "webinar_poll_results"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_poll_results"."org_id" IS NULL OR "webinar_poll_results"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "webinar_polls_tenant_isolation" ON "webinar_polls" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_polls"."org_id" IS NULL OR "webinar_polls"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_polls"."org_id" IS NULL OR "webinar_polls"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "webinar_recordings_tenant_isolation" ON "webinar_recordings" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_recordings"."org_id" IS NULL OR "webinar_recordings"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_recordings"."org_id" IS NULL OR "webinar_recordings"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "webinar_registrations_tenant_isolation" ON "webinar_registrations" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_registrations"."org_id" IS NULL OR "webinar_registrations"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_registrations"."org_id" IS NULL OR "webinar_registrations"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "webinars_tenant_isolation" ON "webinars" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinars"."org_id" IS NULL OR "webinars"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinars"."org_id" IS NULL OR "webinars"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "webinars" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_hosts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_registrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_polls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_poll_options" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_poll_results" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_recordings" FORCE ROW LEVEL SECURITY;
