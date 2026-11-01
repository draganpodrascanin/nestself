-- Organizational feedback cases (ADR 0002, D-EL-01 and D-EL-06; spec Epic F).
-- Four tenant tables under forced row-level security. `feedback_case_reporters`
-- is the only link between a case and the employee who raised it; the tables a
-- handler path reads carry no reporter column. FORCE ROW LEVEL SECURITY is
-- added by hand (drizzle-kit emits ENABLE only), as in 0021.
CREATE TYPE "public"."feedback_case_kind" AS ENUM('problem', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."feedback_case_state" AS ENUM('submitted', 'in_review', 'waiting_for_reporter', 'action_in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."feedback_message_sender" AS ENUM('reporter', 'handler', 'system');--> statement-breakpoint
CREATE TYPE "public"."feedback_route_kind" AS ENUM('standard', 'sensitive');--> statement-breakpoint
CREATE TABLE "feedback_case_reporters" (
	"case_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"reporter_user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_case_reporters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feedback_cases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"route_id" text NOT NULL,
	"kind" "feedback_case_kind" NOT NULL,
	"category" text NOT NULL,
	"anonymous_to_employer" boolean DEFAULT true NOT NULL,
	"pseudonym" text NOT NULL,
	"state" "feedback_case_state" DEFAULT 'submitted' NOT NULL,
	"route_choice" text NOT NULL,
	"handler_user_id" text,
	"next_action" text,
	"due_at" timestamp (3) with time zone,
	"escalated_at" timestamp (3) with time zone,
	"resolved_at" timestamp (3) with time zone,
	"closed_at" timestamp (3) with time zone,
	"outcome_reason" text,
	"last_reporter_visible_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_cases_route_choice_check" CHECK ("feedback_cases"."route_choice" in ('primary', 'alternate'))
);
--> statement-breakpoint
ALTER TABLE "feedback_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feedback_messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"case_id" text NOT NULL,
	"org_id" text NOT NULL,
	"sender" "feedback_message_sender" NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_messages_reporter_anonymous_check" CHECK ("feedback_messages"."sender" <> 'reporter' or "feedback_messages"."author_user_id" is null),
	CONSTRAINT "feedback_messages_internal_check" CHECK ("feedback_messages"."internal" = false or "feedback_messages"."sender" = 'handler')
);
--> statement-breakpoint
ALTER TABLE "feedback_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feedback_routes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"kind" "feedback_route_kind" NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_handler_user_id" text NOT NULL,
	"alternate_handler_user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"operating_hours" text,
	"response_target_hours" integer DEFAULT 72 NOT NULL,
	"escalation_note" text,
	"updated_by_user_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_routes_handlers_check" CHECK ("feedback_routes"."primary_handler_user_id" <> "feedback_routes"."alternate_handler_user_id"),
	CONSTRAINT "feedback_routes_response_target_check" CHECK ("feedback_routes"."response_target_hours" > 0)
);
--> statement-breakpoint
ALTER TABLE "feedback_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_case_reporters" ADD CONSTRAINT "feedback_case_reporters_case_id_feedback_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."feedback_cases"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_case_reporters" ADD CONSTRAINT "feedback_case_reporters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_case_reporters" ADD CONSTRAINT "feedback_case_reporters_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_cases" ADD CONSTRAINT "feedback_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_cases" ADD CONSTRAINT "feedback_cases_route_id_feedback_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."feedback_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_cases" ADD CONSTRAINT "feedback_cases_handler_user_id_users_id_fk" FOREIGN KEY ("handler_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_case_id_feedback_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."feedback_cases"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_routes" ADD CONSTRAINT "feedback_routes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_routes" ADD CONSTRAINT "feedback_routes_primary_handler_user_id_users_id_fk" FOREIGN KEY ("primary_handler_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_routes" ADD CONSTRAINT "feedback_routes_alternate_handler_user_id_users_id_fk" FOREIGN KEY ("alternate_handler_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_routes" ADD CONSTRAINT "feedback_routes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "feedback_case_reporters_reporter_user_id_idx" ON "feedback_case_reporters" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE INDEX "feedback_cases_org_id_state_idx" ON "feedback_cases" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "feedback_cases_handler_user_id_idx" ON "feedback_cases" USING btree ("handler_user_id");--> statement-breakpoint
CREATE INDEX "feedback_cases_due_at_idx" ON "feedback_cases" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "feedback_messages_case_id_created_at_idx" ON "feedback_messages" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_routes_org_id_kind_key" ON "feedback_routes" USING btree ("org_id","kind");--> statement-breakpoint
CREATE POLICY "feedback_case_reporters_tenant_isolation" ON "feedback_case_reporters" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_case_reporters"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_case_reporters"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "feedback_cases_tenant_isolation" ON "feedback_cases" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_cases"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_cases"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "feedback_messages_tenant_isolation" ON "feedback_messages" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_messages"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_messages"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "feedback_routes_tenant_isolation" ON "feedback_routes" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_routes"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "feedback_routes"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "feedback_routes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_cases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_case_reporters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_messages" FORCE ROW LEVEL SECURITY;
