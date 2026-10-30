-- organizations.status takes only the four lifecycle values of the contracts
-- (ORGANIZATION_STATUSES; phase 4, spec 5.1). Generated from the Drizzle
-- schema. A row with any other value stops this migration; correct it first.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_status_check" CHECK ("organizations"."status" in ('ONBOARDING','ACTIVE','SUSPENDED','ENDED'));
