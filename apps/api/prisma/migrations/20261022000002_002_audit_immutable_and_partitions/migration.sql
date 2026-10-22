-- Migration: 002_audit_immutable_and_partitions
-- Raw SQL only (created with --create-only, hand-edited).
--
-- Contents:
-- 1. Convert audit_events to a range-partitioned table on occurred_at.
-- 2. Create initial monthly partitions + DEFAULT partition.
-- 3. Create audit_events_ensure_partitions() function for forward partition creation.
-- 4. Append-only trigger rejecting UPDATE and DELETE on audit_events.
-- 5. "teams" VIEW selecting from org_units WHERE kind = 'TEAM'.
-- 6. Partial indexes for common authorization queries.
-- 7. users_email_lowercase_check CHECK constraint.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Convert audit_events to a range-partitioned table
-- ═══════════════════════════════════════════════════════════════════
-- Safe because no data exists yet (phase 0, before the API starts).

DROP TABLE IF EXISTS "audit_events";

CREATE TABLE "audit_events" (
    "id"                TEXT            NOT NULL DEFAULT gen_random_uuid()::text,
    "occurred_at"       TIMESTAMPTZ     NOT NULL,
    "actor_user_id"     TEXT,
    "actor_kind"        "ActorKind"     NOT NULL,
    "org_id"            TEXT,
    "action"            TEXT            NOT NULL,
    "record_type"       TEXT            NOT NULL,
    "record_id"         TEXT            NOT NULL,
    "result"            "AuditResult"   NOT NULL,
    "category"          "AuditCategory" NOT NULL,
    "details"           JSONB           NOT NULL,
    "session_id"        TEXT,
    "ip_hash"           TEXT,
    "user_agent_family" TEXT,
    "retain_until"      TIMESTAMPTZ     NOT NULL,
    PRIMARY KEY ("id", "occurred_at"),
    CONSTRAINT "fk_audit_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id"),
    CONSTRAINT "fk_audit_org"   FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
) PARTITION BY RANGE ("occurred_at");

-- ═══════════════════════════════════════════════════════════════════
-- 2. Monthly partitions (12 months ahead) + DEFAULT partition
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE "audit_events_default" PARTITION OF "audit_events" DEFAULT;

CREATE TABLE "audit_events_y2026m10" PARTITION OF "audit_events"
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "audit_events_y2026m11" PARTITION OF "audit_events"
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "audit_events_y2026m12" PARTITION OF "audit_events"
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "audit_events_y2027m01" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "audit_events_y2027m02" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "audit_events_y2027m03" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "audit_events_y2027m04" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "audit_events_y2027m05" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "audit_events_y2027m06" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "audit_events_y2027m07" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE "audit_events_y2027m08" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE "audit_events_y2027m09" PARTITION OF "audit_events"
    FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');

-- ═══════════════════════════════════════════════════════════════════
-- 3. audit_events_ensure_partitions(months_ahead int)
-- ═══════════════════════════════════════════════════════════════════
-- Creates monthly partitions for the next N months if they do not exist.

CREATE OR REPLACE FUNCTION audit_events_ensure_partitions(months_ahead INT)
RETURNS VOID AS $$
DECLARE
    i INT;
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..months_ahead - 1 LOOP
        start_date := date_trunc('month', CURRENT_DATE + (i || ' months')::INTERVAL)::DATE;
        end_date := (start_date + INTERVAL '1 month')::DATE;
        partition_name := 'audit_events_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');
        BEGIN
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
                partition_name, start_date, end_date
            );
        EXCEPTION WHEN duplicate_table THEN
            -- Partition already exists; skip.
            NULL;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create initial 12 months of partitions via the function (idempotent; overlaps with static partitions above are handled by IF NOT EXISTS).
SELECT audit_events_ensure_partitions(12);

-- ═══════════════════════════════════════════════════════════════════
-- 4. Recreate indexes on the partitioned table
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX "idx_audit_actor_time" ON "audit_events" ("actor_user_id", "occurred_at");
CREATE INDEX "idx_audit_org_action_time" ON "audit_events" ("org_id", "action", "occurred_at");
CREATE INDEX "idx_audit_record" ON "audit_events" ("record_type", "record_id");
CREATE INDEX "idx_audit_retention" ON "audit_events" ("category", "retain_until");

-- ═══════════════════════════════════════════════════════════════════
-- 5. Append-only audit enforcement (trigger)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION audit_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_no_update
    BEFORE UPDATE ON "audit_events"
    FOR EACH ROW
    EXECUTE FUNCTION audit_events_immutable();

CREATE TRIGGER trg_audit_events_no_delete
    BEFORE DELETE ON "audit_events"
    FOR EACH ROW
    EXECUTE FUNCTION audit_events_immutable();

-- ═══════════════════════════════════════════════════════════════════
-- 6. "teams" VIEW: select from org_units WHERE kind = 'TEAM'
-- ═══════════════════════════════════════════════════════════════════
-- The legacy "teams" table was renamed to "legacy_teams" in migration 001
-- so this view can occupy the "teams" name. It exposes the same columns
-- (id, name, org_id) that the old table had, sourced from org_units.

CREATE OR REPLACE VIEW "teams" AS
SELECT
    "id",
    "name",
    "org_id"
FROM "org_units"
WHERE "kind" = 'TEAM';

-- ═══════════════════════════════════════════════════════════════════
-- 7. Partial indexes for authorization queries
-- ═══════════════════════════════════════════════════════════════════

-- Active grants: not revoked and either indefinite or still valid.
CREATE INDEX "idx_grants_active"
    ON "grants" ("subject_user_id", "scope_org_id")
    WHERE "revoked_at" IS NULL;

-- One active membership per user per organization.
CREATE UNIQUE INDEX "idx_memberships_one_active"
    ON "memberships" ("user_id", "org_id")
    WHERE "status" = 'ACTIVE';

-- Org-level active-member queries.
CREATE INDEX "idx_memberships_active_org"
    ON "memberships" ("org_id")
    WHERE "status" = 'ACTIVE';

-- Active emergency access: not revoked.
CREATE INDEX "idx_emergency_active"
    ON "emergency_access" ("user_id")
    WHERE "revoked_at" IS NULL;

-- Pending invitations.
CREATE INDEX "idx_invitations_pending"
    ON "invitations" ("email", "org_id")
    WHERE "revoked_at" IS NULL AND "accepted_at" IS NULL;

-- RetentionPolicy: close the NULL gap on serviceType.
CREATE UNIQUE INDEX "idx_retention_policy_no_service"
    ON "retention_policies" ("data_category", "jurisdiction")
    WHERE "service_type" IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 8. User email lowercase CHECK constraint
-- ═══════════════════════════════════════════════════════════════════
-- First lowercase any existing rows, then add the constraint.

UPDATE "users" SET "email" = LOWER("email") WHERE "email" <> LOWER("email");

ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check"
    CHECK ("email" = LOWER("email"));
