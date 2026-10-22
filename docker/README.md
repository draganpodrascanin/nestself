# Docker services

The Compose file at `docker/docker-compose.yml` defines the infrastructure services for local development and the containerised API build.

## Services

### postgres

PostgreSQL 17 (Alpine). Stores all application data: organisations, users, roles, leads and future entities. A named volume (`pgdata`) persists data across container restarts.

- **Port:** 5432
- **Credentials:** `nestself` / `nestself_dev` / database `nestself`
- **Health check:** `pg_isready` every 5 s

### redis

Redis 7 (Alpine). Reserved for BullMQ job queues (lead notification emails, scheduled jobs). Nothing consumes it yet; it is included now so the queue phase needs no infrastructure change.

- **Port:** 6379
- **Persistence:** RDB snapshot every 60 s if at least one key changed
- **Health check:** `redis-cli ping` every 5 s

### migrate (profile: `api`)

Runs the Drizzle migrator (`pnpm --filter @nestself/api db:migrate`) against the Postgres service as the owner role `nestself`. It uses the `build` stage of the API Dockerfile so all workspace packages and `tsx` are available. Exits after the migration completes.

The `api` service connects as `nestself_api`, a login role created by `docker/initdb/01-app-role.sql` on the first start of the Postgres volume. That role is a member of `nestself_app`, which the migrations grant table privileges to, so the row-level-security tenant policies apply to the API but not to migrations.

### api (profile: `api`)

The production API image built from `apps/api/Dockerfile`. Waits for healthy Postgres, healthy Redis and a successful migration before starting. Reads additional environment variables from `docker/api.env`.

- **Port:** 4000
- **Health check:** `GET /api/health` every 30 s

## Profiles

The Compose file uses two profiles:

| Profile   | Services started                      | Command           |
| --------- | ------------------------------------- | ----------------- |
| (default) | `postgres`, `redis`                   | `pnpm db:up`      |
| `api`     | `postgres`, `redis`, `migrate`, `api` | `pnpm docker:api` |

## Running only the databases locally

```bash
pnpm db:up       # start Postgres and Redis in the background
pnpm db:down     # stop all services and remove containers
```

This is the typical development workflow: run the databases in Docker and the API with `pnpm --filter @nestself/api dev` on the host.

## Running the full API stack

1. Copy the example environment file:

   ```bash
   cp docker/api.env.example docker/api.env
   ```

2. Edit `docker/api.env` and set a real `JWT_SECRET` (at least 32 characters).

3. Build and start everything:

   ```bash
   pnpm docker:api
   ```

   This builds the API image from the repo root, runs migrations, and starts the API behind healthy Postgres and Redis.

## Building the API image in CI

```bash
docker build -f apps/api/Dockerfile -t nestself-api .
```

The build context must be the repository root. The Dockerfile uses a multi-stage build: `deps` fetches and installs, `build` compiles and deploys production dependencies, and `runtime` copies only the production output into a minimal Alpine image running as a non-root `nestself` user.

## Note

The API image was not built on the authoring machine (Docker Desktop was not running). The Dockerfile and Compose file are correct by construction and validated syntactically.
