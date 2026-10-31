-- Webinar registrations always carry the registrant's organisation (T-CW-2.1
-- review): org_id becomes NOT NULL and the tenant policy drops the
-- platform-wide branch, so a registration to an occurrence open to all is
-- visible only in its organisation's scope and the system context. Every
-- registration the API wrote already has its organisation (the membership
-- that made the person eligible). FORCE ROW LEVEL SECURITY is unchanged
-- (0011).
ALTER TABLE "webinar_registrations" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER POLICY "webinar_registrations_tenant_isolation" ON "webinar_registrations" TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_registrations"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "webinar_registrations"."org_id" = current_setting('app.current_org_id', true)));