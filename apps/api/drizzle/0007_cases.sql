-- Cases (phase 4, spec 4.5): conversations and intake records reference their
-- case together with their organization, so a row of one organization can no
-- longer carry the case id of another. Generated from the Drizzle schema, then
-- edited by hand: the INSERT fills "cases" from the (case_id, org_id) pairs
-- already in use before the composite foreign keys are added, and the FORCE
-- statement at the end binds the owner role to the policy as nestself_app is
-- bound (see 0001). A case id that two organizations share stops this
-- migration when the foreign keys are added; correct those rows by hand first.
CREATE TABLE "cases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_id_org_id_key" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
INSERT INTO "cases" ("id", "org_id")
SELECT DISTINCT "case_id", "org_id" FROM "conversations"
UNION
SELECT DISTINCT "case_id", "org_id" FROM "intake_records"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_case_org_fk" FOREIGN KEY ("case_id","org_id") REFERENCES "public"."cases"("id","org_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_records" ADD CONSTRAINT "intake_records_case_org_fk" FOREIGN KEY ("case_id","org_id") REFERENCES "public"."cases"("id","org_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE POLICY "cases_tenant_isolation" ON "cases" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "cases"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "cases"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
ALTER TABLE "cases" FORCE ROW LEVEL SECURITY;
