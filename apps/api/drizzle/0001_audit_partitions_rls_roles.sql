-- Custom migration: audit partitioning, append-only enforcement, application
-- role and forced row-level security. Hand-written; drizzle-kit cannot express
-- these statements. See docs/tasks/auth/auth-strategy.md A.3.2 and D-37.
--
-- 1. Convert audit_events into a monthly range-partitioned table.
-- 2. Monthly partitions twelve months ahead plus a DEFAULT partition.
-- 3. audit_events_ensure_partitions(months_ahead) for the nightly job.
-- 4. Append-only triggers rejecting UPDATE and DELETE on audit_events.
-- 5. Application role `nestself_app` with table privileges but no UPDATE or
--    DELETE on audit_events. The API connects as a login role that is a member
--    of nestself_app (see docker/initdb/01-app-role.sql); migrations run as the
--    table owner.
-- 6. FORCE ROW LEVEL SECURITY on every tenant-scoped table so that the policies
--    also bind the owner role. Superusers always bypass RLS.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. audit_events as a partitioned table (safe: no data exists yet)
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS "audit_events";
--> statement-breakpoint
CREATE TABLE "audit_events" (
    "id"                text                   NOT NULL DEFAULT gen_random_uuid()::text,
    "occurred_at"       timestamp (3) with time zone NOT NULL,
    "actor_user_id"     text,
    "actor_kind"        "actor_kind"           NOT NULL,
    "org_id"            text,
    "action"            text                   NOT NULL,
    "record_type"       text                   NOT NULL,
    "record_id"         text                   NOT NULL,
    "result"            "audit_result"         NOT NULL,
    "category"          "audit_category"       NOT NULL,
    "details"           jsonb                  NOT NULL,
    "session_id"        text,
    "ip_hash"           text,
    "user_agent_family" text,
    "retain_until"      timestamp (3) with time zone NOT NULL,
    CONSTRAINT "audit_events_id_occurred_at_pk" PRIMARY KEY ("id", "occurred_at"),
    CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Partitions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "audit_events_default" PARTITION OF "audit_events" DEFAULT;
--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. audit_events_ensure_partitions(months_ahead)
-- ═══════════════════════════════════════════════════════════════════════════

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
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
SELECT audit_events_ensure_partitions(12);
--> statement-breakpoint

-- Indexes on the partitioned parent propagate to every partition.
CREATE INDEX "idx_audit_actor_time" ON "audit_events" ("actor_user_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "idx_audit_org_action_time" ON "audit_events" ("org_id", "action", "occurred_at");
--> statement-breakpoint
CREATE INDEX "idx_audit_record" ON "audit_events" ("record_type", "record_id");
--> statement-breakpoint
CREATE INDEX "idx_audit_retention" ON "audit_events" ("category", "retain_until");
--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Append-only enforcement [D-21, AUDIT-R]
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION audit_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_no_update
    BEFORE UPDATE ON "audit_events"
    FOR EACH ROW
    EXECUTE FUNCTION audit_events_immutable();
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_no_delete
    BEFORE DELETE ON "audit_events"
    FOR EACH ROW
    EXECUTE FUNCTION audit_events_immutable();
--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Application role [D-37, A.3.4]
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nestself_app') THEN
        CREATE ROLE nestself_app NOLOGIN;
    END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO nestself_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nestself_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nestself_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nestself_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nestself_app;
--> statement-breakpoint
-- The audit log is append-only for the application even without the trigger.
REVOKE UPDATE, DELETE ON "audit_events" FROM nestself_app;
--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Force RLS so the owner role is bound by the tenant policies too
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_authorities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sso_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "channels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "event_requests" FORCE ROW LEVEL SECURITY;
