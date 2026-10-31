-- Call sessions (T-CW-1.1, NS-CALLS-01): the call_* enums and the seven
-- tenant-scoped call tables (call_sessions, call_participants, call_events,
-- call_client_events, call_outcomes, call_feedback and the schema-only
-- call_consents) [D-CW-07, D-CW-08, D-CW-12, D-CW-13, D-CW-19, D-CW-25].
-- org_id is nullable on every table: a webinar open to every eligible
-- organization has none, and such rows stay visible in every tenant context;
-- a consultation session always has one (call_sessions_consultation_check).
-- Generated from the Drizzle schema; the FORCE statements at the end are
-- hand-written so the owner role is bound by the same policies as
-- nestself_app (see 0001, CW-R-25). No column holds a join token (CW-R-13).
CREATE TYPE "public"."call_consent_type" AS ENUM('RECORDING', 'TRANSCRIPTION');--> statement-breakpoint
CREATE TYPE "public"."call_format" AS ENUM('CONSULTATION', 'WEBINAR', 'WORKSHOP');--> statement-breakpoint
CREATE TYPE "public"."call_outcome_status" AS ENUM('COMPLETED', 'NO_SHOW_EMPLOYEE', 'NO_SHOW_EXPERT', 'TECHNICAL_FAILURE', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."call_participant_role" AS ENUM('EXPERT', 'EMPLOYEE', 'PRESENTER', 'MODERATOR', 'ATTENDEE', 'FACILITATOR', 'PARTICIPANT');--> statement-breakpoint
CREATE TYPE "public"."call_session_status" AS ENUM('PENDING', 'CREATING', 'ACTIVE', 'ENDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('SCHEDULED', 'RECORDING', 'PROCESSING', 'READY', 'HANDED_OFF', 'FAILED');--> statement-breakpoint
CREATE TABLE "call_client_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text,
	"participant_id" text NOT NULL,
	"event_name" text NOT NULL,
	"duration_ms" integer,
	"metrics" jsonb,
	"device_error" text,
	"browser" text,
	"os" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_client_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_consents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text,
	"participant_id" text NOT NULL,
	"consent_type" "call_consent_type" NOT NULL,
	"given_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text,
	"provider_meeting_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_attendee_id" text,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"payload" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_events_dedup_idx" UNIQUE NULLS NOT DISTINCT("provider_meeting_id","event_type","provider_attendee_id","occurred_at")
);
--> statement-breakpoint
ALTER TABLE "call_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_feedback" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_feedback_score_check" CHECK ("call_feedback"."score" BETWEEN 1 AND 5),
	CONSTRAINT "call_feedback_comment_length_check" CHECK (char_length("call_feedback"."comment") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "call_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_outcomes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text,
	"status" "call_outcome_status" NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"connection_metrics" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_participants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"role" "call_participant_role" NOT NULL,
	"provider_attendee_id" text,
	"first_joined_at" timestamp (3) with time zone,
	"last_left_at" timestamp (3) with time zone,
	"reconnect_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_participants_reconnect_count_check" CHECK ("call_participants"."reconnect_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "call_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"appointment_id" text,
	"webinar_id" text,
	"org_id" text,
	"format" "call_format" NOT NULL,
	"provider_meeting_id" text,
	"status" "call_session_status" DEFAULT 'PENDING' NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone,
	"ended_at" timestamp (3) with time zone,
	"location_text" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_sessions_ends_after_starts_check" CHECK ("call_sessions"."ends_at" > "call_sessions"."starts_at"),
	CONSTRAINT "call_sessions_consultation_check" CHECK ("call_sessions"."format" <> 'CONSULTATION' OR ("call_sessions"."appointment_id" IS NOT NULL AND "call_sessions"."org_id" IS NOT NULL)),
	CONSTRAINT "call_sessions_webinar_check" CHECK ("call_sessions"."format" <> 'WEBINAR' OR "call_sessions"."webinar_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "call_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_client_events" ADD CONSTRAINT "call_client_events_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_client_events" ADD CONSTRAINT "call_client_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_client_events" ADD CONSTRAINT "call_client_events_participant_id_call_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."call_participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_consents" ADD CONSTRAINT "call_consents_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_consents" ADD CONSTRAINT "call_consents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_consents" ADD CONSTRAINT "call_consents_participant_id_call_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."call_participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_feedback" ADD CONSTRAINT "call_feedback_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_feedback" ADD CONSTRAINT "call_feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_feedback" ADD CONSTRAINT "call_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_outcomes" ADD CONSTRAINT "call_outcomes_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_outcomes" ADD CONSTRAINT "call_outcomes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_outcomes" ADD CONSTRAINT "call_outcomes_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_client_events_session_id_created_at_idx" ON "call_client_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "call_client_events_participant_id_idx" ON "call_client_events" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "call_consents_session_id_idx" ON "call_consents" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "call_events_session_id_idx" ON "call_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_feedback_session_id_user_id_idx" ON "call_feedback" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_outcomes_session_id_idx" ON "call_outcomes" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_participants_session_id_user_id_idx" ON "call_participants" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "call_participants_user_id_idx" ON "call_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "call_participants_provider_attendee_id_idx" ON "call_participants" USING btree ("provider_attendee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_appointment_id_live_idx" ON "call_sessions" USING btree ("appointment_id") WHERE status <> 'FAILED';--> statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_provider_meeting_id_idx" ON "call_sessions" USING btree ("provider_meeting_id");--> statement-breakpoint
CREATE INDEX "call_sessions_webinar_id_idx" ON "call_sessions" USING btree ("webinar_id");--> statement-breakpoint
CREATE INDEX "call_sessions_status_ends_at_idx" ON "call_sessions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE POLICY "call_client_events_tenant_isolation" ON "call_client_events" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_client_events"."org_id" IS NULL OR "call_client_events"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_client_events"."org_id" IS NULL OR "call_client_events"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "call_consents_tenant_isolation" ON "call_consents" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_consents"."org_id" IS NULL OR "call_consents"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_consents"."org_id" IS NULL OR "call_consents"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "call_events_tenant_isolation" ON "call_events" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_events"."org_id" IS NULL OR "call_events"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_events"."org_id" IS NULL OR "call_events"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "call_feedback_tenant_isolation" ON "call_feedback" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_feedback"."org_id" IS NULL OR "call_feedback"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_feedback"."org_id" IS NULL OR "call_feedback"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "call_outcomes_tenant_isolation" ON "call_outcomes" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_outcomes"."org_id" IS NULL OR "call_outcomes"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_outcomes"."org_id" IS NULL OR "call_outcomes"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "call_participants_tenant_isolation" ON "call_participants" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_participants"."org_id" IS NULL OR "call_participants"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_participants"."org_id" IS NULL OR "call_participants"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "call_sessions_tenant_isolation" ON "call_sessions" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_sessions"."org_id" IS NULL OR "call_sessions"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "call_sessions"."org_id" IS NULL OR "call_sessions"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "call_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_client_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_outcomes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_feedback" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_consents" FORCE ROW LEVEL SECURITY;
