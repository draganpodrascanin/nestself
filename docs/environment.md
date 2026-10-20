# Environment variables

All variables are listed in `.env.example` at the repository root. Copy the relevant section into the app's own env file before starting it.

## API (`apps/api/.env`)

| Variable         | Meaning                                                                   | Default                                                      |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `NODE_ENV`       | Node environment (`development`, `production`, `test`)                    | `development`                                                |
| `PORT`           | HTTP port the API listens on                                              | `4000`                                                       |
| `DATABASE_URL`   | PostgreSQL connection string                                              | `postgresql://nestself:nestself_dev@localhost:5432/nestself` |
| `JWT_SECRET`     | Secret used to sign and verify JWT tokens; must be at least 32 characters | `change-me-to-at-least-32-characters-long-please`            |
| `JWT_EXPIRES_IN` | JWT token lifetime (e.g. `1h`, `30m`)                                     | `1h`                                                         |
| `MARKETING_URL`  | Origin of the marketing app, used for CORS                                | `http://localhost:3000`                                      |
| `WORKSPACE_URL`  | Origin of the workspace app, used for CORS                                | `http://localhost:5173`                                      |
| `ADMIN_URL`      | Origin of the admin app, used for CORS                                    | `http://localhost:5174`                                      |

## Workspace and Admin (`apps/workspace/.env.local`, `apps/admin/.env.local`)

| Variable           | Meaning                                                                                                    | Default                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| `VITE_API_URL`     | Base URL for API requests (proxied by Vite in development)                                                 | `http://localhost:4000` |
| `VITE_DATA_SOURCE` | Data source mode: `sample` renders fictional fixtures and the sample-data banner; `api` calls the real API | `sample`                |

## Mobile (`apps/mobile/.env.local`)

| Variable                  | Meaning                                                             | Default                 |
| ------------------------- | ------------------------------------------------------------------- | ----------------------- |
| `EXPO_PUBLIC_API_URL`     | Base URL for API requests from the mobile app                       | `http://localhost:4000` |
| `EXPO_PUBLIC_DATA_SOURCE` | Data source mode: `sample` or `api`, same behaviour as the web apps | `sample`                |

## Marketing (`apps/marketing/.env.local`)

| Variable               | Meaning                                                      | Default                 |
| ---------------------- | ------------------------------------------------------------ | ----------------------- |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL, used for metadata and sitemap generation | `http://localhost:3000` |

## Notes

- `VITE_DATA_SOURCE` and `EXPO_PUBLIC_DATA_SOURCE` default to `sample` in development. In sample mode, apps import fixtures from `@nestself/sample-data` and display a banner on every screen.
- The `DATABASE_URL` default matches the Docker Compose service in `docker/docker-compose.yml` (user `nestself`, password `nestself_dev`, database `nestself` on port 5432).
- The API seed script (`pnpm --filter @nestself/api prisma:seed`) refuses to run when `NODE_ENV` is `production`.
