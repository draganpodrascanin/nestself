-- Per-connection switch for OIDC providers that never send email_verified
-- (phase 4, spec 4.2, SSO-R-08). On by default, so every existing connection
-- keeps requiring the claim. Generated from the Drizzle schema.
ALTER TABLE "sso_connections" ADD COLUMN "oidc_email_verified_claim_required" boolean DEFAULT true NOT NULL;
