-- Row-level security for the tables that reach their organization through a
-- join: the legacy community tables (posts, polls, poll_options, poll_votes)
-- and org_unit_closure [D-19, D-37]. The policies were generated from the
-- Drizzle schema; the FORCE statements below are hand-written so the owner
-- role is bound by the same policies as nestself_app (see 0001).
ALTER TABLE "org_unit_closure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poll_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poll_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "polls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_unit_closure_tenant_isolation" ON "org_unit_closure" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "org_units" where "org_units"."id" = "org_unit_closure"."ancestor_id" and "org_units"."org_id" = current_setting('app.current_org_id', true)))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "org_units" where "org_units"."id" = "org_unit_closure"."ancestor_id" and "org_units"."org_id" = current_setting('app.current_org_id', true))));--> statement-breakpoint
CREATE POLICY "poll_options_tenant_isolation" ON "poll_options" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "polls" join "legacy_teams" on "legacy_teams"."id" = "polls"."team_id" where "polls"."id" = "poll_options"."poll_id" and "legacy_teams"."org_id" = current_setting('app.current_org_id', true)))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "polls" join "legacy_teams" on "legacy_teams"."id" = "polls"."team_id" where "polls"."id" = "poll_options"."poll_id" and "legacy_teams"."org_id" = current_setting('app.current_org_id', true))));--> statement-breakpoint
CREATE POLICY "poll_votes_tenant_isolation" ON "poll_votes" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "poll_options" join "polls" on "polls"."id" = "poll_options"."poll_id" join "legacy_teams" on "legacy_teams"."id" = "polls"."team_id" where "poll_options"."id" = "poll_votes"."option_id" and "legacy_teams"."org_id" = current_setting('app.current_org_id', true)))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "poll_options" join "polls" on "polls"."id" = "poll_options"."poll_id" join "legacy_teams" on "legacy_teams"."id" = "polls"."team_id" where "poll_options"."id" = "poll_votes"."option_id" and "legacy_teams"."org_id" = current_setting('app.current_org_id', true))));--> statement-breakpoint
CREATE POLICY "polls_tenant_isolation" ON "polls" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "legacy_teams" where "legacy_teams"."id" = "polls"."team_id" and "legacy_teams"."org_id" = current_setting('app.current_org_id', true)))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "legacy_teams" where "legacy_teams"."id" = "polls"."team_id" and "legacy_teams"."org_id" = current_setting('app.current_org_id', true))));--> statement-breakpoint
CREATE POLICY "posts_tenant_isolation" ON "posts" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "channels" where "channels"."id" = "posts"."channel_id" and "channels"."org_id" = current_setting('app.current_org_id', true)))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "channels" where "channels"."id" = "posts"."channel_id" and "channels"."org_id" = current_setting('app.current_org_id', true))));--> statement-breakpoint
ALTER TABLE "posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "polls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poll_options" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poll_votes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_unit_closure" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The nightly partition job runs as the application role, which does not own
-- audit_events. Creating a partition needs ownership, so the function runs with
-- the owner's rights and a fixed search_path; only nestself_app may call it.
ALTER FUNCTION audit_events_ensure_partitions(INT) SECURITY DEFINER SET search_path = public;--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_events_ensure_partitions(INT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_events_ensure_partitions(INT) TO nestself_app;
