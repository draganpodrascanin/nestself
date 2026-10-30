-- Media replication for webinars above one meeting (T-CW-3.2, D-CW-14):
-- the session keeps its replica meeting ids in replica order (Chime cannot
-- list a primary's replicas), and a participant its replica and, while a
-- replica attendee holds the floor, its promotion attendee on the primary.
-- Column additions only: the tables' RLS policies and FORCE ROW LEVEL
-- SECURITY (0007) are unchanged.
ALTER TABLE "call_participants" ADD COLUMN "replica_index" integer;--> statement-breakpoint
ALTER TABLE "call_participants" ADD COLUMN "floor_attendee_id" text;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "replica_meeting_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_replica_index_check" CHECK ("call_participants"."replica_index" IS NULL OR "call_participants"."replica_index" >= 1);