# @nestself/admin

NestSelf back office SPA built with Vite, React, TanStack Router and Tailwind.

## Routes

| Path | Description |
| --- | --- |
| `/` | Dashboard overview with sample metrics |
| `/experts` | Experts table with density switch |
| `/experts/:expertId` | Expert detail (stub) |
| `/organizations` | Organisations listing |
| `/organizations/:orgId` | Organisation detail with teams and programme |
| `/content` | Content articles with area and locale badges |
| `/event-requests` | Event request summary |
| `/settings` | Locale, appearance and privacy settings |

## Session stub

The admin app uses a sample session with `platformRole: 'admin'` by default. In development, append `?role=<platformRole>` (e.g. `?role=expert`, `?role=operations`) to switch roles. A session without a `platformRole` sees the permission block.

## Development

```sh
pnpm --filter @nestself/admin dev
```

Runs on port 5174.
