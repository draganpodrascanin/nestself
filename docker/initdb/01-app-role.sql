-- Runs once when the Postgres volume is first initialised (docker-entrypoint-initdb.d).
-- Creates the group role the migrations grant privileges to and the login role
-- the API connects as. Row-level security policies bind nestself_api because it
-- is neither a superuser nor the table owner [D-19, D-37].
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nestself_app') THEN
        CREATE ROLE nestself_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nestself_api') THEN
        CREATE ROLE nestself_api LOGIN PASSWORD 'nestself_api_dev';
    END IF;
END
$$;
GRANT nestself_app TO nestself_api;
GRANT CONNECT ON DATABASE nestself TO nestself_api;
