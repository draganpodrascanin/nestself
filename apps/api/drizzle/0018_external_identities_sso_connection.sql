-- The SSO connection a federated identity was bound through (phase 4, spec
-- 5.5). Generated from the Drizzle schema, then edited by hand: the UPDATE
-- binds every existing federated identity ("cognito:<provider name>") to the
-- connection that holds that provider name, before the foreign key is added.
-- The pool-native identity ("cognito") and a provider name no connection holds
-- any more stay null.
ALTER TABLE "external_identities" ADD COLUMN "sso_connection_id" text;--> statement-breakpoint
UPDATE "external_identities" AS ei
SET "sso_connection_id" = c."id"
FROM "sso_connections" AS c
WHERE ei."provider" = 'cognito:' || c."cognito_provider_name";--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_sso_connection_id_sso_connections_id_fk" FOREIGN KEY ("sso_connection_id") REFERENCES "public"."sso_connections"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "external_identities_sso_connection_id_idx" ON "external_identities" USING btree ("sso_connection_id");
