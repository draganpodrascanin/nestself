-- Follow-up approval items (T-CW-1.10, NS-CALLS-01, D-CW-37): one row per
-- follow-up waiting for an approver under the MANAGER_APPROVAL policy, naming
-- the approver and alternate chosen from approval_authorities. Tenant-scoped;
-- generated from the Drizzle schema, the FORCE statement at the end is
-- hand-written so the owner role is bound by the same policy as nestself_app
-- (see 0001, CW-R-25).
CREATE TABLE "appointment_approvals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"appointment_id" text NOT NULL,
	"org_id" text NOT NULL,
	"org_unit_id" text,
	"approver_user_id" text NOT NULL,
	"alternate_user_id" text,
	"status" "appointment_approval_status" DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"decided_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_approvals_reason_length_check" CHECK ("appointment_approvals"."reason" is null or char_length("appointment_approvals"."reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "appointment_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment_approvals" ADD CONSTRAINT "appointment_approvals_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_approvals" ADD CONSTRAINT "appointment_approvals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_approvals" ADD CONSTRAINT "appointment_approvals_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_approvals" ADD CONSTRAINT "appointment_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_approvals" ADD CONSTRAINT "appointment_approvals_alternate_user_id_users_id_fk" FOREIGN KEY ("alternate_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_approvals_appointment_id_idx" ON "appointment_approvals" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_approvals_org_id_approver_user_id_idx" ON "appointment_approvals" USING btree ("org_id","approver_user_id");--> statement-breakpoint
CREATE INDEX "appointment_approvals_org_id_alternate_user_id_idx" ON "appointment_approvals" USING btree ("org_id","alternate_user_id");--> statement-breakpoint
CREATE POLICY "appointment_approvals_tenant_isolation" ON "appointment_approvals" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "appointment_approvals"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "appointment_approvals"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "appointment_approvals" FORCE ROW LEVEL SECURITY;
