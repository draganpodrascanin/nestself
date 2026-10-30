-- Call session end reason (T-CW-1.2, NS-CALLS-01, D-CW-09, D-CW-12): who
-- closed an ENDED session. The expert's end, calls.cleanup and calls.reconcile
-- stamp it before they call the provider, so a MeetingEnded event that wins
-- the race keeps their reason; PROVIDER means Chime ended the meeting on its
-- own (an empty meeting, OPS-03). A PROVIDER end no longer blocks the
-- appointment's live-session index, so a join inside the window can start a
-- new session. Generated from the Drizzle schema; no policy changes, and
-- call_sessions keeps FORCE ROW LEVEL SECURITY from 0007.
CREATE TYPE "public"."call_session_end_reason" AS ENUM('EXPERT', 'PROVIDER', 'CLEANUP', 'RECONCILE');--> statement-breakpoint
DROP INDEX "call_sessions_appointment_id_live_idx";--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "end_reason" "call_session_end_reason";--> statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_appointment_id_live_idx" ON "call_sessions" USING btree ("appointment_id") WHERE status <> 'FAILED' AND end_reason IS DISTINCT FROM 'PROVIDER';