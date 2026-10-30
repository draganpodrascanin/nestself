-- sso_domains becomes tenant-scoped through its connection (phase 3, D-12,
-- D-19). The index and policy were generated from the Drizzle schema; the
-- FORCE statement at the end is hand-written so the owner role is bound by
-- the same policy as nestself_app (see 0001).
ALTER TABLE "sso_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "sso_domains_connection_id_verified_at_idx" ON "sso_domains" USING btree ("connection_id","verified_at");--> statement-breakpoint
CREATE POLICY "sso_domains_tenant_isolation" ON "sso_domains" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "sso_connections" where "sso_connections"."id" = "sso_domains"."connection_id" and "sso_connections"."org_id" = current_setting('app.current_org_id', true)))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR EXISTS (select 1 from "sso_connections" where "sso_connections"."id" = "sso_domains"."connection_id" and "sso_connections"."org_id" = current_setting('app.current_org_id', true))));--> statement-breakpoint
ALTER TABLE "sso_domains" FORCE ROW LEVEL SECURITY;
