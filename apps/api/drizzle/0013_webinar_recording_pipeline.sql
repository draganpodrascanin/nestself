-- Webinar recording pipeline (T-CW-2.5, NS-CALLS-01, D-CW-18, D-CW-29,
-- D-CW-34): the capture pipeline's ARN (the concatenation source, WEB-29),
-- the concatenation pipeline the finalize job polls, the CMS handoff location
-- and the failure state on webinar_recordings; call_sessions.webinar_id gains
-- its foreign key to webinars; webinar_messages.author_user_id becomes
-- nullable so the author link can be removed 12 months after the occurrence.
-- Generated from the Drizzle schema. No policy changes: every table keeps its
-- policy, and the FORCE statements at the end restate the forced RLS of 0007
-- and 0011 on the three tables this migration alters (idempotent).
ALTER TABLE "webinar_messages" ALTER COLUMN "author_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD COLUMN "provider_pipeline_arn" text;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD COLUMN "concatenation_pipeline_id" text;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD COLUMN "handoff_location" text;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "webinar_recordings" ADD COLUMN "failed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_webinar_id_webinars_id_fk" FOREIGN KEY ("webinar_id") REFERENCES "public"."webinars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webinar_recordings" FORCE ROW LEVEL SECURITY;
