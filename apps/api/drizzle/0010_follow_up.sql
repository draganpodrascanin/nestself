-- Follow-up lifecycle (T-CW-1.9, NS-CALLS-01, D-CW-37): the organization's
-- follow_up_approval_policy (AUTOMATIC by default, or MANAGER_APPROVAL; the
-- tenant anchor, so no policy change), and on appointments the employee's
-- suggested windows (one to three { startsAt, endsAt }, times only) with the
-- proposal and response times. Generated from the Drizzle schema; no table is
-- added and no policy changes, so every FORCE ROW LEVEL SECURITY statement of
-- 0001 to 0007 stays as it was (appointments keeps the one from 0006).
ALTER TABLE "organizations" ADD COLUMN "follow_up_approval_policy" text DEFAULT 'AUTOMATIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "suggested_windows" jsonb;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "proposed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "responded_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_follow_up_approval_policy_check" CHECK ("organizations"."follow_up_approval_policy" in ('AUTOMATIC', 'MANAGER_APPROVAL'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_suggested_windows_check" CHECK (case when "appointments"."suggested_windows" is null then true when jsonb_typeof("appointments"."suggested_windows") = 'array' then jsonb_array_length("appointments"."suggested_windows") between 1 and 3 else false end);