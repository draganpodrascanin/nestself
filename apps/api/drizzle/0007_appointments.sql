-- Appointment spine (T-CW-0.6, NS-CALLS-01): the appointment_status and
-- appointment_approval_status enums and the tenant-scoped appointments table
-- with its follow_up_of self-reference [D-CW-02, D-CW-37]. Generated from the
-- Drizzle schema; the FORCE statement at the end is hand-written so the owner
-- role is bound by the same policy as nestself_app (see 0001, CW-R-25).
CREATE TYPE "public"."appointment_approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('PROPOSED', 'AWAITING_APPROVAL', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'DECLINED', 'NO_SHOW');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"expert_user_id" text NOT NULL,
	"employee_user_id" text NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'CONFIRMED' NOT NULL,
	"service_category" text NOT NULL,
	"time_zone" text DEFAULT 'Europe/Belgrade' NOT NULL,
	"funding_ref" text,
	"follow_up_of" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_ends_after_starts_check" CHECK ("appointments"."ends_at" > "appointments"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_expert_user_id_users_id_fk" FOREIGN KEY ("expert_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_employee_user_id_users_id_fk" FOREIGN KEY ("employee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_follow_up_of_appointments_id_fk" FOREIGN KEY ("follow_up_of") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_org_id_starts_at_idx" ON "appointments" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_employee_user_id_starts_at_idx" ON "appointments" USING btree ("employee_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_expert_user_id_starts_at_idx" ON "appointments" USING btree ("expert_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_follow_up_of_idx" ON "appointments" USING btree ("follow_up_of");--> statement-breakpoint
CREATE POLICY "appointments_tenant_isolation" ON "appointments" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "appointments"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "appointments"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
